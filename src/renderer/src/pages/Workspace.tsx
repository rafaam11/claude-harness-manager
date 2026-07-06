import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { marked } from "marked";
import { api, fmtDate, fmtDay, fmtRelative, fmtSize, fmtTime } from "../api/client";
import GitPanel from "./git/GitPanel";
import type {
  EntityId,
  ProviderFilter,
} from "@shared/provider-types";
import {
  STATUSES,
  buildProjNameMap,
  displayName,
  modelBadgeClass,
  modelDisplayName,
  projectVisibilityWrite,
  shortName,
  stripClaudeEntityId,
  type BoardStatus,
  type EnrichedPlan,
  type ProjectTrack,
  type SessionRecall,
  type WorkspaceProject,
} from "./workspace-shared";

// 왼쪽 마스터 목록의 '미연결 계획' 가상 항목 식별자(프로젝트 id와 충돌 안 나는 센티넬)
const UNASSIGNED = "__unassigned__";

type ProjectPatch = {
  status?: BoardStatus;
  memo?: string;
  nameOverride?: string | null;
  tracks?: ProjectTrack[];
  hidden?: boolean;
  order?: number | null;
};
type PlanPatch = { status?: BoardStatus; memo?: string; projectOverride?: EntityId | null };

// 정렬 모드: 뷰 전역 취향이라 localStorage에 저장(테마와 동일 패턴), board.json엔 안 둔다.
type SortMode = "recent" | "status" | "manual";
const DEFAULT_WORKSPACE_SORT: SortMode = "status";

export function workspaceProviderToneClass(p: WorkspaceProject): string {
  const ids = p.memberIds?.length ? p.memberIds : [p.id];
  const hasClaude = p.provider === "claude" || ids.some((id) => id.startsWith("claude:"));
  const hasCodex = p.provider === "codex" || ids.some((id) => id.startsWith("codex:"));
  if (hasClaude && hasCodex) return " ws-provider-mixed";
  if (hasClaude) return " ws-provider-claude";
  if (hasCodex) return " ws-provider-codex";
  return "";
}
const SORT_KEY = "ws-sort-mode";
const SORT_MODES: SortMode[] = ["recent", "status", "manual"];
const SORT_LABELS: Record<SortMode, string> = {
  recent: "최근 활동순",
  status: "상태순",
  manual: "수동 정렬",
};
export function initialWorkspaceSortMode(stored: string | null): SortMode {
  return SORT_MODES.includes(stored as SortMode) ? (stored as SortMode) : DEFAULT_WORKSPACE_SORT;
}
// 상태 정렬 rank(작을수록 위). 무상태(null)는 진행중 바로 뒤.
const STATUS_RANK: Record<BoardStatus, number> = {
  진행중: 0,
  보류: 2,
  완료: 3,
  보관: 4,
};
function statusRank(s: BoardStatus | null): number {
  return s ? STATUS_RANK[s] : 1;
}
function sortProjects(projects: WorkspaceProject[], mode: SortMode): WorkspaceProject[] {
  const arr = [...projects];
  if (mode === "status") {
    arr.sort((a, b) => statusRank(a.board.status) - statusRank(b.board.status) || b.lastActivity - a.lastActivity);
  } else if (mode === "manual") {
    const ord = (p: WorkspaceProject) => (p.board.order ?? Infinity);
    arr.sort((a, b) => ord(a) - ord(b) || b.lastActivity - a.lastActivity);
  } else {
    arr.sort((a, b) => b.lastActivity - a.lastActivity);
  }
  return arr;
}

export function resolveWorkspaceSelection(
  selectedId: string | null,
  projects: WorkspaceProject[],
  unassignedCount: number,
): string | null {
  if (selectedId && projects.some((project) => project.id === selectedId)) return selectedId;
  const first = projects.find((p) => !p.board.hidden) ?? projects[0];
  if (first) return first.id;
  return unassignedCount > 0 ? UNASSIGNED : null;
}

export function partitionWorkspaceSessions(sessions: SessionRecall[]): {
  primary: SessionRecall[];
  auxiliary: SessionRecall[];
} {
  const primary: SessionRecall[] = [];
  const auxiliary: SessionRecall[] = [];
  for (const session of sessions) {
    if (session.sessionKind === "worker" || session.sessionKind === "system") auxiliary.push(session);
    else primary.push(session);
  }
  return { primary, auxiliary };
}

function sessionKindRank(session: SessionRecall): number {
  if (session.sessionKind === "main") return 4;
  if (session.sessionKind === "unknown" || !session.sessionKind) return 3;
  if (session.sessionKind === "worker") return 2;
  if (session.sessionKind === "system") return 1;
  return 0;
}

function hasSessionRecallText(session: SessionRecall): boolean {
  return Boolean(session.aiTitle || session.lastPrompt || session.lastAssistantSnippet);
}

function betterSessionTextSource(a: SessionRecall, b: SessionRecall): SessionRecall {
  const ar = sessionKindRank(a);
  const br = sessionKindRank(b);
  if (ar !== br) return br > ar ? b : a;
  const at = hasSessionRecallText(a);
  const bt = hasSessionRecallText(b);
  if (at !== bt) return bt ? b : a;
  return b.transcriptMtime >= a.transcriptMtime ? b : a;
}

function preferWorkspaceSessionKind(
  a: SessionRecall["sessionKind"],
  b: SessionRecall["sessionKind"],
): SessionRecall["sessionKind"] {
  const ar = sessionKindRank({ sessionKind: a } as SessionRecall);
  const br = sessionKindRank({ sessionKind: b } as SessionRecall);
  return br > ar ? b : a;
}

function mergeWorkspaceSession(a: SessionRecall, b: SessionRecall): SessionRecall {
  const latest = b.transcriptMtime >= a.transcriptMtime ? b : a;
  const textSource = betterSessionTextSource(a, b);
  return {
    ...latest,
    sessionKind: preferWorkspaceSessionKind(a.sessionKind, b.sessionKind),
    aiTitle: textSource.aiTitle ?? latest.aiTitle,
    lastPrompt: textSource.lastPrompt ?? latest.lastPrompt,
    lastAssistantSnippet: latest.lastAssistantSnippet ?? textSource.lastAssistantSnippet,
    cwd: latest.cwd ?? textSource.cwd,
    gitBranch: latest.gitBranch ?? textSource.gitBranch,
    lastModel: latest.lastModel ?? textSource.lastModel,
    transcriptPath: textSource.transcriptPath,
    transcriptMtime: Math.max(a.transcriptMtime, b.transcriptMtime),
    truncatedScan: a.truncatedScan || b.truncatedScan,
  };
}

export function mergeWorkspaceSessionLists(lists: SessionRecall[][]): SessionRecall[] {
  const byKey = new Map<string, SessionRecall>();
  for (const session of lists.flat()) {
    const key = session.sessionId ? `sid:${session.sessionId}` : `path:${session.transcriptPath}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeWorkspaceSession(prev, session) : session);
  }
  return [...byKey.values()].sort((a, b) => b.transcriptMtime - a.transcriptMtime);
}

export function workspaceProjectMetricLabels(p: WorkspaceProject, planCount: number): string[] {
  const labels: string[] = [];
  const totalTodos = p.board.tracks.reduce((n, t) => n + t.items.length, 0);
  const doneTodos = p.board.tracks.reduce((n, t) => n + t.items.filter((i) => i.done).length, 0);
  if (totalTodos > 0) labels.push(`✓ ${doneTodos}/${totalTodos}`);
  if (planCount > 0) labels.push(`📄 ${planCount}`);
  return labels;
}

function StatusTag({ s }: { s: BoardStatus }) {
  return <span className={`tag st-${STATUSES.indexOf(s)}`}>{s}</span>;
}

// ============================ 루트: 좌우 2단 마스터-디테일 ============================
interface Props {
  providerFilter: ProviderFilter;
}

export default function Workspace({ providerFilter }: Props) {
  return <ClaudeWorkspace providerFilter={providerFilter} />;
}

function ClaudeWorkspace({ providerFilter }: { providerFilter: ProviderFilter }) {
  const [projects, setProjects] = useState<WorkspaceProject[] | null>(null);
  const [plans, setPlans] = useState<EnrichedPlan[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(
    () => initialWorkspaceSortMode(localStorage.getItem(SORT_KEY)),
  );
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0); // 세션 탭에 조용한 재fetch 신호
  const providerQuery = `provider=${encodeURIComponent(providerFilter)}`;

  const changeSort = (m: SortMode) => {
    setSortMode(m);
    localStorage.setItem(SORT_KEY, m);
  };

  // 로딩 리셋 없이 조용히 데이터만 교체(자동/수동 갱신에서 재사용). 포커스 복귀 리스너의
  // stale 클로저를 막기 위해 providerQuery에만 의존하도록 useCallback으로 안정화한다.
  const loadProjects = useCallback(
    () =>
      api
        .get<WorkspaceProject[]>(`/api/workspace/projects?${providerQuery}`)
        .then(setProjects)
        .catch((e) => setError(e.message)),
    [providerQuery],
  );
  // 보관 계획도 항상 흐리게 함께 보여주므로 archived=1로 한 번에 가져온다.
  const loadPlans = useCallback(
    () =>
      api
        .get<EnrichedPlan[]>(`/api/workspace/plans?archived=1&${providerQuery}`)
        .then(setPlans)
        .catch((e) => setError(e.message)),
    [providerQuery],
  );
  // 개요는 loadProjects가 p를 새 객체로 교체하면 갱신되고, 세션은 nonce로 재fetch를 유도한다.
  const refresh = useCallback(() => {
    loadProjects();
    loadPlans();
    setRefreshNonce((n) => n + 1);
  }, [loadProjects, loadPlans]);
  useEffect(() => {
    setProjects(null);
    setPlans(null);
    setSelectedId(null);
    setError("");
    loadProjects();
    loadPlans();
  }, [providerQuery]);

  // 다른 창(Claude Code 등)에서 작업하고 돌아오면 최신으로 조용히 갱신.
  useEffect(() => {
    const onFocus = () => refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  // 정렬 모드(최근 활동순/상태순/수동)별 정렬. 회상 대시보드 기본은 상태순.
  const sorted = useMemo(
    () => (projects ? sortProjects(projects, sortMode) : []),
    [projects, sortMode],
  );

  // 계획을 projectId(override ?? guessed)로 그룹핑. null이면 미연결.
  const plansByProject = useMemo(() => {
    const m = new Map<string, EnrichedPlan[]>();
    for (const pl of plans ?? []) {
      const key = pl.projectId ?? UNASSIGNED;
      const arr = m.get(key);
      if (arr) arr.push(pl);
      else m.set(key, [pl]);
    }
    return m;
  }, [plans]);

  const projName = useMemo(() => buildProjNameMap(sorted), [sorted]);
  const unassigned = plansByProject.get(UNASSIGNED) ?? [];
  const projectPlans = (p: WorkspaceProject) =>
    (p.memberIds?.length ? p.memberIds : [p.id]).flatMap((id) => plansByProject.get(id) ?? []);

  // 기본/필터 변경 선택: 현재 선택이 사라지면 첫(숨김 제외) 프로젝트로 보정.
  useEffect(() => {
    const next = resolveWorkspaceSelection(selectedId, sorted, unassigned.length);
    if (next !== selectedId) setSelectedId(next);
  }, [sorted, selectedId, unassigned.length]);

  async function patchProject(id: string, body: ProjectPatch) {
    // 낙관적 업데이트. nameOverride는 해제용 null을 쓰므로 board(string)에는 ""로 정규화.
    const boardPatch: Partial<WorkspaceProject["board"]> = {};
    if (body.status !== undefined) boardPatch.status = body.status;
    if (body.memo !== undefined) boardPatch.memo = body.memo;
    if (body.nameOverride !== undefined) boardPatch.nameOverride = body.nameOverride ?? "";
    if (body.tracks !== undefined) boardPatch.tracks = body.tracks;
    if (body.hidden !== undefined) boardPatch.hidden = body.hidden;
    if (body.order !== undefined) boardPatch.order = body.order;
    setProjects((prev) =>
      prev
        ? prev.map((p) => (p.id === id ? { ...p, board: { ...p.board, ...boardPatch } } : p))
        : prev,
    );
    // hidden/status만 단독으로 바뀌는 경우(숨김 버튼·상태 드롭다운) 병합 카드면 memberIds에 팬아웃.
    const visibilityOnly =
      (body.hidden !== undefined || body.status !== undefined) &&
      body.memo === undefined &&
      body.nameOverride === undefined &&
      body.tracks === undefined &&
      body.order === undefined;
    const req = visibilityOnly
      ? projectVisibilityWrite(projects?.find((p) => p.id === id), id, {
          hidden: body.hidden,
          status: body.status,
        })
      : { url: `/api/workspace/board/project/${encodeURIComponent(id)}`, body };
    try {
      await api.post(req.url, req.body);
    } catch (e) {
      setError((e as Error).message);
      loadProjects(); // 실패 시 서버 상태로 재동기화
    }
  }

  // 수동 정렬: 표시 중인(숨김 제외) 카드 목록에서 id를 dir 방향 이웃과 swap하고
  // 전체에 0..n-1 순번을 부여해 한 번의 배치 write로 저장(.bak 링 소진 방지).
  async function moveProject(id: string, dir: -1 | 1) {
    const list = sorted.filter((p) => !p.board.hidden);
    const i = list.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = [...list];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
    const orders: Record<string, number> = {};
    reordered.forEach((p, idx) => (orders[p.id] = idx));
    setProjects((prev) =>
      prev
        ? prev.map((p) =>
            p.id in orders ? { ...p, board: { ...p.board, order: orders[p.id] } } : p,
          )
        : prev,
    );
    try {
      await api.post(`/api/workspace/board/projects/order`, { orders });
    } catch (e) {
      setError((e as Error).message);
      loadProjects();
    }
  }

  async function patchPlan(filename: string, body: PlanPatch) {
    setPlans((prev) =>
      prev ? prev.map((p) => (p.filename === filename ? applyPlanPatch(p, body) : p)) : prev,
    );
    try {
      await api.post(`/api/workspace/board/plan/${encodeURIComponent(filename)}`, body);
    } catch (e) {
      setError((e as Error).message);
      loadPlans();
    }
  }

  async function openFolder(realPath: string) {
    try {
      const msg = await window.app.openPath(realPath);
      if (msg) setError(`폴더 열기 실패: ${msg}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (error) return <div className="banner err">{error}</div>;
  if (!projects || !plans) return <div className="muted">불러오는 중…</div>;

  const selectedProject =
    selectedId && selectedId !== UNASSIGNED ? sorted.find((p) => p.id === selectedId) ?? null : null;
  const visible = sorted.filter((p) => !p.board.hidden);
  const hiddenProjects = sorted.filter((p) => p.board.hidden);

  const renderCard = (p: WorkspaceProject, list: WorkspaceProject[], idx: number) => (
    <ProjectMasterCard
      key={p.id}
      p={p}
      planCount={projectPlans(p).length}
      active={selectedId === p.id}
      sortMode={sortMode}
      isFirst={idx === 0}
      isLast={idx === list.length - 1}
      onSelect={() => setSelectedId(p.id)}
      onHide={(hidden) => patchProject(p.id, { hidden })}
      onMove={(dir) => moveProject(p.id, dir)}
    />
  );

  return (
    <div>
      <h2>Workspace</h2>
      {projects.length === 0 && unassigned.length === 0 ? (
        <div className="muted">프로젝트 기록이 없습니다.</div>
      ) : (
        <div className="ws-split">
          <div className="ws-master">
            <div className="ws-sortbar">
              <label className="ws-sort-k">정렬</label>
              <select
                className="ws-select"
                value={sortMode}
                onChange={(e) => changeSort(e.target.value as SortMode)}
              >
                {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
                  <option key={m} value={m}>
                    {SORT_LABELS[m]}
                  </option>
                ))}
              </select>
              <button
                className="ws-icon-btn ws-refresh"
                onClick={refresh}
                title="새로고침 (최신 회상·세션 다시 불러오기)"
                aria-label="새로고침"
              >
                ↻
              </button>
            </div>
            {visible.map((p, idx) => renderCard(p, visible, idx))}
            <button
              className={`ws-master-item unassigned${selectedId === UNASSIGNED ? " active" : ""}`}
              onClick={() => setSelectedId(UNASSIGNED)}
            >
              📋 미연결 계획 <span className="cat-count">{unassigned.length}</span>
            </button>
            {hiddenProjects.length > 0 && (
              <>
                <button
                  className="ws-hidden-toggle"
                  onClick={() => setHiddenOpen((v) => !v)}
                >
                  {hiddenOpen ? "▾" : "▸"} 숨긴 프로젝트{" "}
                  <span className="cat-count">{hiddenProjects.length}</span>
                </button>
                {hiddenOpen &&
                  hiddenProjects.map((p, idx) => renderCard(p, hiddenProjects, idx))}
              </>
            )}
          </div>

          <div className="ws-detail">
            {selectedId === UNASSIGNED ? (
              <UnassignedDetail
                plans={unassigned}
                projects={sorted}
                projName={projName}
                onPatchPlan={patchPlan}
              />
            ) : selectedProject ? (
              <ProjectDetail
                key={selectedProject.id}
                p={selectedProject}
                refreshNonce={refreshNonce}
                onPatch={patchProject}
                onOpenFolder={openFolder}
                onError={setError}
              />
            ) : (
              <div className="muted">왼쪽에서 프로젝트를 선택하세요.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function applyPlanPatch(p: EnrichedPlan, body: PlanPatch): EnrichedPlan {
  const next = { ...p };
  if (body.status) next.status = body.status;
  if (body.memo !== undefined) next.memo = body.memo;
  if (body.projectOverride !== undefined) {
    next.projectOverride = body.projectOverride || null;
    next.projectId = next.projectOverride ?? p.guessedProjectId;
  }
  return next;
}

// ============================ 왼쪽 마스터: 프로젝트 컴팩트 카드 ============================
// hover 액션(숨기기·수동 정렬 화살표)을 카드 안에 넣어야 해서 button 중첩이 불가 → div role="button".
function ProjectMasterCard({
  p,
  planCount,
  active,
  sortMode,
  isFirst,
  isLast,
  onSelect,
  onHide,
  onMove,
}: {
  p: WorkspaceProject;
  planCount: number;
  active: boolean;
  sortMode: SortMode;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onHide: (hidden: boolean) => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const metricLabels = workspaceProjectMetricLabels(p, planCount);
  // 자식 컨트롤 클릭이 카드 선택으로 번지지 않게 막는다.
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div
      className={`ws-master-item${workspaceProviderToneClass(p)}${active ? " active" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="ws-mi-head">
        <span className="ws-mi-name">{displayName(p)}</span>
        {p.board.status && <StatusTag s={p.board.status} />}
      </div>
      <div className="ws-mi-meta">
        <span>{fmtRelative(p.lastActivity)}</span>
        {metricLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="ws-mi-actions">
        {sortMode === "manual" && !p.board.hidden && (
          <>
            <button
              className="ws-mi-act"
              title="위로"
              disabled={isFirst}
              onClick={stop(() => onMove(-1))}
            >
              ▲
            </button>
            <button
              className="ws-mi-act"
              title="아래로"
              disabled={isLast}
              onClick={stop(() => onMove(1))}
            >
              ▼
            </button>
          </>
        )}
        <button
          className="ws-mi-act"
          title={p.board.hidden ? "숨김 해제" : "숨기기"}
          onClick={stop(() => onHide(!p.board.hidden))}
        >
          {p.board.hidden ? <Eye size={14} strokeWidth={1.75} /> : <EyeOff size={14} strokeWidth={1.75} />}
        </button>
      </div>
    </div>
  );
}

// ============================ 오른쪽 디테일: 프로젝트 상세 ============================
function ProjectDetail({
  p,
  refreshNonce,
  onPatch,
  onOpenFolder,
  onError,
}: {
  p: WorkspaceProject;
  refreshNonce: number;
  onPatch: (id: string, body: ProjectPatch) => void;
  onOpenFolder: (realPath: string) => void;
  onError: (message: string) => void;
}) {
  const r = p.recall;
  const base = shortName(p.realPath, p.id);
  const projectIds = p.memberIds?.length ? p.memberIds : [p.id];
  const hasClaudeMember = projectIds.some((id) => id.startsWith("claude:"));

  const [detailMode, setDetailMode] = useState<"overview" | "session" | "git">("overview");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const startEditName = () => {
    setNameDraft(p.board.nameOverride || "");
    setEditingName(true);
  };
  const saveName = () => {
    setEditingName(false);
    onPatch(p.id, { nameOverride: nameDraft.trim() || null });
  };

  return (
    <div className={`ws-detail-inner${workspaceProviderToneClass(p)}`}>
      <div className="ws-card-head">
        {editingName ? (
          <>
            <input
              className="ws-title-input"
              autoFocus
              value={nameDraft}
              placeholder={base}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                else if (e.key === "Escape") setEditingName(false);
              }}
            />
            <button className="ws-icon-btn" onClick={saveName} title="저장">
              ✓
            </button>
            <button className="ws-icon-btn" onClick={() => setEditingName(false)} title="취소">
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="ws-title">{displayName(p)}</span>
            <button className="ws-icon-btn" onClick={startEditName} title="이름 변경">
              ✎
            </button>
            {p.realPath && (
              <button
                className="ws-icon-btn"
                onClick={() => onOpenFolder(p.realPath!)}
                title="폴더 열기"
              >
                📂
              </button>
            )}
          </>
        )}
        {p.gitBranch && <span className="t-tag">⎇ {p.gitBranch}</span>}
        {p.recall?.lastModel && (
          <span className={`bdg ${modelBadgeClass(p.recall.lastModel)}`} title={p.recall.lastModel}>
            {modelDisplayName(p.recall.lastModel)}
          </span>
        )}
        <span className="ws-when">{fmtRelative(p.lastActivity)}</span>
        <select
          className="ws-select"
          value={p.board.status ?? ""}
          onChange={(e) => onPatch(p.id, { status: (e.target.value || "진행중") as BoardStatus })}
        >
          <option value="">상태 없음</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="ws-detail-mode">
        <button
          className={`ws-mode-tab${detailMode === "overview" ? " active" : ""}`}
          onClick={() => setDetailMode("overview")}
        >
          개요
        </button>
        <button
          className={`ws-mode-tab${detailMode === "session" ? " active" : ""}`}
          onClick={() => setDetailMode("session")}
        >
          세션
        </button>
        <button
          className={`ws-mode-tab${detailMode === "git" ? " active" : ""}`}
          onClick={() => setDetailMode("git")}
        >
          Git
        </button>
      </div>
      {detailMode === "git" ? (
        <GitPanel key="main" projectId={p.id} onError={onError} />
      ) : detailMode === "session" ? (
        <>
          <SessionsSection projectIds={projectIds} refreshNonce={refreshNonce} />
          {hasClaudeMember && <MemorySection projectId={projectIds.find((id) => id.startsWith("claude:")) ?? p.id} />}
        </>
      ) : (
        <>
          <div className="ws-path mono">{p.realPath ?? p.id}</div>

      {r ? (
        <div className="ws-recall">
          {r.aiTitle && <div className="ws-aititle">📌 {r.aiTitle}</div>}
          {r.lastPrompt && (
            <div className="ws-line ws-line-full">
              <span className="ws-line-k">마지막 입력</span> {r.lastPrompt}
            </div>
          )}
          {r.lastAssistantSnippet && (
            <div className="ws-line">
              <span className="ws-line-k">마지막 응답</span>
              <div
                className="md-body ws-snippet-md"
                dangerouslySetInnerHTML={{
                  __html: marked.parse(r.lastAssistantSnippet, { breaks: true }) as string,
                }}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="muted ws-recall">최근 세션 기록 없음</div>
      )}

      {p.todos && (
        <div className="ws-chips">
          <span className={`tag ${p.todos.done === p.todos.total ? "ok" : "muted"}`}>
            ✓ 할일 {p.todos.done}/{p.todos.total}
          </span>
        </div>
      )}

      <MemoBox
        value={p.board.memo}
        placeholder="자유메모"
        onSave={(memo) => onPatch(p.id, { memo })}
      />

      <div className="ws-plans-head">
        트랙 / 할 일
        {(() => {
          const total = p.board.tracks.reduce((n, t) => n + t.items.length, 0);
          const done = p.board.tracks.reduce((n, t) => n + t.items.filter((i) => i.done).length, 0);
          return total > 0 ? (
            <span className="cat-count">
              {done}/{total}
            </span>
          ) : null;
        })()}
      </div>
      <TrackEditor tracks={p.board.tracks} onSave={(tracks) => onPatch(p.id, { tracks })} />
        </>
      )}
    </div>
  );
}

// ============================ 세션 탭(그룹 내 모든 세션 — Timeline 행 스타일 재사용) ============================
function SessionsSection({
  projectIds,
  refreshNonce,
}: {
  projectIds: string[];
  refreshNonce: number;
}) {
  const [sessions, setSessions] = useState<SessionRecall[] | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [auxOpen, setAuxOpen] = useState(false);
  const projectKey = projectIds.join("\n");
  const prevKeyRef = useRef(projectKey);

  useEffect(() => {
    let alive = true;
    // 다른 프로젝트로 전환(projectKey 변경) 시에만 로딩 표시. nonce만 증가한 조용한 갱신은
    // 기존 목록을 유지하고 완료 시 결과만 교체해 깜빡임을 없앤다.
    if (prevKeyRef.current !== projectKey) {
      prevKeyRef.current = projectKey;
      setSessions(null);
    }
    setError("");
    // 병합 카드에서 멤버 하나의 조회 실패가 전체를 가리지 않게 성공분만 표시(전부 실패 시에만 에러)
    Promise.allSettled(
      projectIds.map((projectId) =>
        api.get<SessionRecall[]>(`/api/workspace/projects/${encodeURIComponent(projectId)}/sessions`),
      ),
    ).then((results) => {
      if (!alive) return;
      const lists = results
        .filter((r): r is PromiseFulfilledResult<SessionRecall[]> => r.status === "fulfilled")
        .map((r) => r.value);
      if (lists.length === 0 && results.length > 0) {
        const first = results[0] as PromiseRejectedResult;
        setError((first.reason as Error).message);
        return;
      }
      setSessions(mergeWorkspaceSessionLists(lists));
    });
    return () => {
      alive = false;
    };
  }, [projectKey, refreshNonce]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  if (error) return <div className="banner err">{error}</div>;
  if (!sessions) return <div className="muted">불러오는 중…</div>;
  if (sessions.length === 0) return <div className="muted">세션 기록이 없습니다.</div>;
  const { primary, auxiliary } = partitionWorkspaceSessions(sessions);

  return (
    <div className="timeline">
      <SessionRows sessions={primary} expanded={expanded} onToggle={toggle} />
      {primary.length === 0 && <div className="muted">직접 대화 세션이 없습니다.</div>}
      {auxiliary.length > 0 && (
        <>
          <button className="ws-section-toggle" onClick={() => setAuxOpen((v) => !v)}>
            <span className="ws-plan-caret">{auxOpen ? "▾" : "▸"}</span>
            보조 활동 / worker 세션 <span className="cat-count">{auxiliary.length}</span>
          </button>
          {auxOpen && <SessionRows sessions={auxiliary} expanded={expanded} onToggle={toggle} auxiliary />}
        </>
      )}
    </div>
  );
}

function SessionRows({
  sessions,
  expanded,
  onToggle,
  auxiliary = false,
}: {
  sessions: SessionRecall[];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  auxiliary?: boolean;
}) {
  return (
    <>
      {sessions.map((s) => {
        const key = s.transcriptPath;
        const open = expanded.has(key);
        return (
          <div className={`timeline-row${auxiliary ? " timeline-row-child" : ""}`} key={key}>
            <div className="timeline-item" onClick={() => onToggle(key)}>
              {auxiliary && <span className="bdg bdg-model-missing">AUX</span>}
              {s.lastModel && (
                <span className={`bdg ${modelBadgeClass(s.lastModel)}`} title={s.lastModel}>
                  {modelDisplayName(s.lastModel)}
                </span>
              )}
              <span className="timeline-time muted">
                {fmtDay(s.transcriptMtime)} {fmtTime(s.transcriptMtime)}
              </span>
              <span className="timeline-title">{s.aiTitle ?? s.lastPrompt ?? "(제목 없음)"}</span>
              <span className="timeline-caret muted">{open ? "▾" : "▸"}</span>
            </div>
            {open && (
              <div className="timeline-expand">
                {s.lastPrompt && (
                  <p className="tl-prompt">
                    <span className="ws-line-k">마지막 입력</span> {s.lastPrompt}
                  </p>
                )}
                {s.lastAssistantSnippet && (
                  <div>
                    <span className="ws-line-k">마지막 응답</span>
                    <div
                      className="md-body ws-snippet-md"
                      dangerouslySetInnerHTML={{
                        __html: marked.parse(s.lastAssistantSnippet, { breaks: true }) as string,
                      }}
                    />
                  </div>
                )}
                {!s.lastPrompt && !s.lastAssistantSnippet && (
                  <div className="muted">표시할 내용이 없습니다.</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ============================ 메모리 / 파일 브라우저(프로젝트 디렉토리) ============================
interface FileInfo {
  path: string;
  size: number;
  mtime: number;
}
// 경로에 memory 폴더가 포함된 파일(Windows/POSIX 구분자 모두)
const MEMORY_RE = /(^|[\\/])memory[\\/]/;

function MemorySection({ projectId }: { projectId: string }) {
  const localProjectId = stripClaudeEntityId(projectId);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<FileInfo[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [content, setContent] = useState<{ path: string; text: string; truncated: boolean } | null>(
    null,
  );
  const [error, setError] = useState("");

  async function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (files === null) {
      try {
        setFiles(
          await api.get<FileInfo[]>(`/api/projects/${encodeURIComponent(localProjectId)}/files`),
        );
      } catch (e) {
        setError((e as Error).message);
        setFiles([]);
      }
    }
  }

  async function openFile(rel: string) {
    try {
      const d = await api.get<{ content: string; truncated: boolean }>(
        `/api/projects/${encodeURIComponent(localProjectId)}/file?path=${encodeURIComponent(rel)}`,
      );
      setContent({ path: rel, text: d.content, truncated: d.truncated });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const memoryCount = files ? files.filter((f) => MEMORY_RE.test(f.path)).length : 0;
  const base = files ? (showAll ? files : files.filter((f) => MEMORY_RE.test(f.path))) : [];
  const shown = [...base].sort((a, b) => b.mtime - a.mtime); // 최신순

  return (
    <>
      <button className="ws-section-toggle" onClick={toggleOpen}>
        <span className="ws-plan-caret">{open ? "▾" : "▸"}</span>
        메모리 / 파일
        {files && <span className="cat-count">{showAll ? files.length : memoryCount}</span>}
      </button>
      {open && (
        <div className="ws-files">
          {error && <div className="banner err">{error}</div>}
          <label className="ws-toggle">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            전체 파일 보기 (트랜스크립트 포함)
          </label>
          {files === null ? (
            <div className="muted">불러오는 중…</div>
          ) : shown.length === 0 ? (
            <div className="muted">
              {showAll ? "파일이 없습니다." : "memory 파일이 없습니다. '전체 파일 보기'를 켜보세요."}
            </div>
          ) : (
            <div className="ws-files-list">
              {shown.map((f) => (
                <button
                  key={f.path}
                  className="ws-file-row"
                  onClick={() => openFile(f.path)}
                  title={f.path}
                >
                  <span className="ws-file-path mono">{f.path}</span>
                  <span className="ws-file-meta muted">
                    {fmtSize(f.size)} · {fmtDate(f.mtime)}
                  </span>
                </button>
              ))}
            </div>
          )}
          {content && (
            <div className="ws-file-content">
              <div className="ws-file-content-head mono">
                <span className="ws-file-path">{content.path}</span>
                {content.truncated && <span className="tag warn">앞부분만</span>}
                <button className="ws-icon-btn" onClick={() => setContent(null)} title="닫기">
                  ✕
                </button>
              </div>
              <pre className="viewer">{content.text}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ============================ 오른쪽 디테일: 미연결 계획 ============================
function UnassignedDetail({
  plans,
  projects,
  projName,
  onPatchPlan,
}: {
  plans: EnrichedPlan[];
  projects: WorkspaceProject[];
  projName: Map<string, string>;
  onPatchPlan: (filename: string, body: PlanPatch) => void;
}) {
  return (
    <div className="ws-detail-inner">
      <div className="ws-plans-head no-top">
        📋 미연결 계획 <span className="cat-count">{plans.length}</span>
      </div>
      <p className="ws-track-hint">
        어떤 프로젝트와도 자동 연결되지 않은 계획입니다. 각 계획의 드롭다운으로 프로젝트에 연결하세요.
      </p>
      {plans.length === 0 ? (
        <div className="muted">미연결 계획이 없습니다.</div>
      ) : (
        plans.map((pl) => (
          <PlanRow
            key={pl.filename}
            p={pl}
            projects={projects}
            projName={projName}
            onPatch={onPatchPlan}
          />
        ))
      )}
    </div>
  );
}

// ============================ 계획 행(컴팩트 + 클릭 펼침) ============================
function PlanRow({
  p,
  projects,
  projName,
  onPatch,
}: {
  p: EnrichedPlan;
  projects: WorkspaceProject[];
  projName: Map<string, string>;
  onPatch: (filename: string, body: PlanPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<string | null>(null);
  const guessedName = p.guessedProjectId
    ? projName.get(p.guessedProjectId) ?? p.guessedProjectId
    : "없음";

  async function toggleBody() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (body === null) {
      try {
        const c = await api.get<{ raw: string }>(
          `/api/workspace/plan/content?filename=${encodeURIComponent(p.filename)}&archived=${
            p.archived ? 1 : 0
          }`,
        );
        setBody(c.raw);
      } catch {
        setBody("(본문을 불러오지 못했습니다)");
      }
    }
  }

  return (
    <div className={`ws-plan-row${p.archived ? " archived" : ""}`}>
      <button className="ws-plan-row-head" onClick={toggleBody}>
        <span className="ws-plan-caret">{open ? "▾" : "▸"}</span>
        {p.archived && <span className="t-tag">📦</span>}
        <span className="ws-plan-title">{p.title}</span>
        <StatusTag s={p.archived ? "보관" : p.status} />
        <span className="ws-plan-date">{fmtDate(p.mtime)}</span>
      </button>
      {open && (
        <div className="ws-plan-body-wrap">
          <div className="ws-plan-controls">
            <select
              className="ws-select grow"
              value={p.projectOverride ?? ""}
              onChange={(e) =>
                onPatch(p.filename, {
                  projectOverride: e.target.value ? (e.target.value as EntityId) : null,
                })
              }
              title="연결된 프로젝트 (수동 지정)"
            >
              <option value="">자동: {guessedName}</option>
              {projects.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {displayName(pr)}
                </option>
              ))}
            </select>
            {!p.archived && (
              <select
                className="ws-select"
                value={p.status}
                onChange={(e) => onPatch(p.filename, { status: e.target.value as BoardStatus })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
          </div>
          <MemoBox value={p.memo} placeholder="메모…" onSave={(memo) => onPatch(p.filename, { memo })} />
          <div
            className="md-body ws-planbody"
            dangerouslySetInnerHTML={{
              __html: marked.parse(body ?? "불러오는 중…") as string,
            }}
          />
        </div>
      )}
    </div>
  );
}

// ============================ 트랙 / 할 일 ============================
type SaveState = "idle" | "editing" | "saved";

/** 두 트랙 배열의 내용이 같은지(얕은 비교). 외부 변경 감지 / 내 저장 에코 식별에 쓴다. */
function sameTracks(a: ProjectTrack[], b: ProjectTrack[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.title !== y.title || x.items.length !== y.items.length) return false;
    for (let j = 0; j < x.items.length; j++) {
      const p = x.items[j];
      const q = y.items[j];
      if (p.id !== q.id || p.text !== q.text || p.done !== q.done) return false;
    }
  }
  return true;
}

function TrackEditor({
  tracks,
  onSave,
}: {
  tracks: ProjectTrack[];
  onSave: (tracks: ProjectTrack[]) => void;
}) {
  // 단일 저장 모델: 텍스트는 700ms 디바운스, 구조 변경(추가/삭제/토글)·blur는 즉시 flush.
  const [draft, setDraft] = useState(tracks);
  const [focusId, setFocusId] = useState<string | null>(null); // 방금 추가한 트랙/할 일에 포커스
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dirtyRef = useRef(false); // 로컬 미저장 편집 존재
  const pendingRef = useRef<ProjectTrack[] | null>(null); // 방금 보낸 값(낙관적 에코 식별)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // 진짜 외부 변경(서버 재동기화)만 draft에 반영. 타이핑 중·내 저장 에코는 무시(기존 리셋 버그 차단).
  useEffect(() => {
    if (dirtyRef.current) return;
    if (sameTracks(tracks, pendingRef.current)) return;
    setDraft(tracks);
  }, [tracks]);

  // 언마운트(프로젝트 전환 등) 시 미저장 텍스트 flush
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        onSaveRef.current(draftRef.current);
      }
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const flushSave = (next: ProjectTrack[]) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingRef.current = next;
    dirtyRef.current = false;
    onSave(next);
    setSaveState("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaveState("idle"), 2000);
  };
  const scheduleSave = (next: ProjectTrack[]) => {
    setDraft(next);
    dirtyRef.current = true;
    setSaveState("editing");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushSave(next), 700);
  };
  const commitNow = (next: ProjectTrack[]) => {
    setDraft(next);
    flushSave(next);
  };
  const flushNow = () => {
    if (saveTimer.current) flushSave(draftRef.current);
  };

  const updateTrack = (id: string, patch: Partial<ProjectTrack>, immediate: boolean) => {
    const next = draft.map((t) => (t.id === id ? { ...t, ...patch } : t));
    immediate ? commitNow(next) : scheduleSave(next);
  };
  const addTrack = () => {
    const id = crypto.randomUUID();
    setFocusId(id);
    commitNow([...draft, { id, title: "", items: [] }]);
  };
  const removeTrack = (id: string) => commitNow(draft.filter((t) => t.id !== id));

  return (
    <div className="ws-tracks">
      {draft.map((t) => (
        <TrackRow
          key={t.id}
          track={t}
          focusId={focusId}
          requestFocus={setFocusId}
          onTitle={(title) => updateTrack(t.id, { title }, false)}
          onItems={(items, immediate) => updateTrack(t.id, { items }, immediate)}
          onRemove={() => removeTrack(t.id)}
          onFlush={flushNow}
        />
      ))}
      {draft.length === 0 && (
        <p className="ws-track-hint">
          트랙 = 이 프로젝트의 작업 갈래(예: 백엔드 / 리팩터). 갈래별로 할 일을 묶어요. 가벼운 진행
          메모는 위 메모 칸, 긴 설계는 아래 Plans를 쓰세요.
        </p>
      )}
      <div className="ws-track-foot">
        <button className="ws-track-add" onClick={addTrack}>
          + 트랙 추가
        </button>
        <span className={`ws-save-cue${saveState === "idle" ? " hidden" : ""}`}>
          {saveState === "editing" ? "편집 중…" : saveState === "saved" ? "저장됨 ✓" : ""}
        </span>
      </div>
    </div>
  );
}

function TrackRow({
  track,
  focusId,
  requestFocus,
  onTitle,
  onItems,
  onRemove,
  onFlush,
}: {
  track: ProjectTrack;
  focusId: string | null;
  requestFocus: (id: string) => void;
  onTitle: (title: string) => void;
  onItems: (items: ProjectTrack["items"], immediate: boolean) => void;
  onRemove: () => void;
  onFlush: () => void;
}) {
  const [open, setOpen] = useState(true);
  const done = track.items.filter((i) => i.done).length;
  const total = track.items.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const setItem = (id: string, patch: { text?: string; done?: boolean }, immediate: boolean) =>
    onItems(
      track.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      immediate,
    );
  const addItem = () => {
    const id = crypto.randomUUID();
    requestFocus(id);
    onItems([...track.items, { id, text: "", done: false }], true);
  };
  const removeItem = (id: string) =>
    onItems(
      track.items.filter((i) => i.id !== id),
      true,
    );

  return (
    <div className="ws-track">
      <div className="ws-track-head">
        <button className="ws-track-toggle" onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"}
        </button>
        <input
          className="ws-track-title"
          value={track.title}
          placeholder="트랙 이름"
          autoFocus={focusId === track.id}
          onChange={(e) => onTitle(e.target.value)}
          onBlur={onFlush}
        />
        {total > 0 && (
          <>
            <div className="ws-track-bar" title={`${done}/${total}`}>
              <span className={pct === 100 ? "full" : ""} style={{ width: `${pct}%` }} />
            </div>
            <span className="ws-track-count muted">
              {done}/{total}
            </span>
          </>
        )}
        <button className="ws-icon-btn" onClick={onRemove} title="트랙 삭제">
          🗑
        </button>
      </div>
      {open && (
        <div className="ws-track-items">
          {track.items.map((i) => (
            <div className="ws-todo" key={i.id}>
              <input
                type="checkbox"
                checked={i.done}
                onChange={(e) => setItem(i.id, { done: e.target.checked }, true)}
              />
              <textarea
                className={`ws-todo-text${i.done ? " done" : ""}`}
                rows={1}
                value={i.text}
                placeholder="할 일…"
                autoFocus={focusId === i.id}
                onChange={(e) => setItem(i.id, { text: e.target.value }, false)}
                onBlur={onFlush}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
              <button className="ws-icon-btn" onClick={() => removeItem(i.id)} title="삭제">
                ✕
              </button>
            </div>
          ))}
          <button className="ws-todo-add" onClick={addItem}>
            + 할 일 추가
          </button>
        </div>
      )}
    </div>
  );
}

// ============================ 공용: 메모 편집 ============================
function MemoBox({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (memo: string) => void;
}) {
  const [text, setText] = useState(value);
  const focusedRef = useRef(false);
  const dirtyRef = useRef(false); // 포커스 중 실제 편집 여부(미편집 blur가 외부 변경을 덮어쓰지 않게)
  // 외부 값이 바뀌면(재동기화) 반영 — 단, 입력 중(포커스)에는 사용자 텍스트를 덮어쓰지 않는다
  useEffect(() => {
    if (!focusedRef.current) setText(value);
  }, [value]);
  return (
    <textarea
      className="ws-memo"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        dirtyRef.current = true;
        setText(e.target.value);
      }}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (dirtyRef.current && text !== value) onSave(text);
        else if (text !== value) setText(value); // 미편집 상태면 보류했던 외부 값으로 재동기화
        dirtyRef.current = false;
      }}
    />
  );
}
