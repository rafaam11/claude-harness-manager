// DT_GitManager에서 흡수. History 모드 좌측: 레인 그래프 + 컬러 ref + 가상 스크롤(useGit).
// DT의 onRepoStatusChanged 실시간 구독·초기 load effect는 제거(Context가 로드/수동 갱신 담당).
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommitNode } from "@shared/types";
import { useGit, type ActionReq } from "./GitContext";
import { compactMetrics } from "../../git/graphMetrics";
import { headAncestors } from "../../git/headAncestors";
import GraphSvg from "./GraphSvg";
import GraphSidebarRow from "./GraphSidebarRow";
import CommitContextMenu, { type MenuPosition } from "./CommitContextMenu";
import InProgressBanner from "./InProgressBanner";
import Spinner from "./Spinner";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import PromptDialog, { type PromptRequest } from "./PromptDialog";

const OVERSCAN = 8;
const { ROW_H, gutterWidth, laneX, laneColor } = compactMetrics;

export default function GraphSidebar({
  onShowChanges,
}: {
  onShowChanges: () => void;
}): React.JSX.Element {
  const {
    commits,
    layout,
    graphLoading,
    truncated,
    headOid,
    selectedOid,
    selectCommit,
    runAction,
    status,
  } = useGit();

  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);

  const openMenu = useCallback((e: React.MouseEvent, commit: CommitNode) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, commit });
  }, []);

  const dispatch = useCallback((req: ActionReq) => runAction(req), [runAction]);

  const requestConfirm = useCallback(
    (req: ActionReq, title: string, message: string) => {
      setConfirm({
        title,
        message,
        confirmLabel: "실행",
        onConfirm: () => {
          setConfirm(null);
          dispatch(req);
        },
      });
    },
    [dispatch],
  );

  const requestPrompt = useCallback(
    (kind: "branch-create" | "tag-create", title: string, placeholder: string, oid: string) => {
      setPrompt({
        title,
        placeholder,
        confirmLabel: "생성",
        onSubmit: (name) => {
          setPrompt(null);
          dispatch({ kind, oid, name });
        },
      });
    },
    [dispatch],
  );

  const copyText = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }, []);

  const ancestors = useMemo(() => headAncestors(commits, headOid), [commits, headOid]);

  const changedCount = status?.changedCount ?? 0;
  const offset = changedCount > 0 ? ROW_H : 0;
  const total = commits.length;
  const first = Math.max(0, Math.floor((scrollTop - offset) / ROW_H) - OVERSCAN);
  const last = Math.min(total - 1, Math.ceil((scrollTop + viewportH - offset) / ROW_H) + OVERSCAN);
  const visible = total > 0 ? commits.slice(first, last + 1) : [];
  const gw = layout ? gutterWidth(layout.laneCount) : 0;
  const headNode = layout?.nodes.find((n) => n.oid === headOid);
  const headLaneX = laneX(headNode?.lane ?? 0);
  const headColor = laneColor(headNode?.colorIndex ?? 0);

  return (
    <div className="graph-view">
      <InProgressBanner />
      <div className="graph-scroll" ref={scrollRef} onScroll={onScroll}>
        {total === 0 ? (
          <div className="panel-placeholder">
            {graphLoading ? <Spinner label="그래프 불러오는 중..." /> : "커밋이 없습니다"}
          </div>
        ) : (
          <div className="graph-spacer" style={{ height: total * ROW_H + offset }}>
            {changedCount > 0 && (
              <div
                className="history-row uncommitted"
                style={{ top: 0, height: ROW_H, paddingLeft: gw }}
                onClick={onShowChanges}
                title="변경 사항 보기"
              >
                <svg
                  width={gw}
                  height={ROW_H}
                  style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
                >
                  <line
                    x1={headLaneX}
                    y1={ROW_H / 2}
                    x2={headLaneX}
                    y2={ROW_H}
                    stroke={headColor}
                    strokeWidth={2}
                    strokeDasharray="2 3"
                  />
                  <circle
                    cx={headLaneX}
                    cy={ROW_H / 2}
                    r={4}
                    fill="var(--bg)"
                    stroke={headColor}
                    strokeWidth={1.5}
                    strokeDasharray="2 2"
                  />
                </svg>
                <span className="history-subject">
                  <em>Uncommitted Changes</em> ({changedCount})
                </span>
              </div>
            )}
            {visible.map((commit, i) => {
              const node = layout?.nodes[first + i];
              return (
                <GraphSidebarRow
                  key={commit.oid}
                  commit={commit}
                  top={(first + i) * ROW_H + offset}
                  rowHeight={ROW_H}
                  gutterWidth={gw}
                  colorIndex={node?.colorIndex ?? 0}
                  selected={commit.oid === selectedOid}
                  isHead={commit.oid === headOid}
                  muted={!ancestors.has(commit.oid)}
                  onSelect={(oid) => selectCommit(oid)}
                  onContext={openMenu}
                />
              );
            })}
            {layout && (
              <GraphSvg
                layout={layout}
                first={first}
                last={last}
                total={total}
                headOid={headOid}
                metrics={compactMetrics}
                topOffset={offset}
              />
            )}
          </div>
        )}
      </div>
      {truncated && (
        <div className="graph-footer">최근 {total.toLocaleString()}개 커밋만 표시합니다</div>
      )}
      {menu && (
        <CommitContextMenu
          pos={menu}
          onClose={() => setMenu(null)}
          onRun={dispatch}
          onConfirm={requestConfirm}
          onPrompt={requestPrompt}
          onCopy={copyText}
        />
      )}
      {confirm && <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />}
      {prompt && <PromptDialog request={prompt} onCancel={() => setPrompt(null)} />}
    </div>
  );
}
