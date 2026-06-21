// DT_GitManager에서 흡수. Changes 모드 좌측: 필터 + 그룹별 파일 목록 + 커밋 박스(useGit).
import { useState } from "react";
import type { StatusEntry } from "@shared/types";
import { useGit } from "./GitContext";
import ConfirmDialog, { type ConfirmRequest } from "./ConfirmDialog";
import Spinner from "./Spinner";
import FileSection from "./FileSection";
import ChangesFilter from "./ChangesFilter";
import CommitBox from "./CommitBox";

interface Groups {
  conflicted: StatusEntry[];
  staged: StatusEntry[];
  unstaged: StatusEntry[];
  untracked: StatusEntry[];
}

/** Splits status entries into the panel's sections (mirrors parseStatusV2 counting). */
function groupEntries(entries: StatusEntry[]): Groups {
  const isTracked = (e: StatusEntry): boolean => e.kind === "tracked" || e.kind === "renamed";
  return {
    conflicted: entries.filter((e) => e.kind === "unmerged"),
    staged: entries.filter((e) => isTracked(e) && e.indexStatus !== "."),
    unstaged: entries.filter((e) => isTracked(e) && e.worktreeStatus !== "."),
    untracked: entries.filter((e) => e.kind === "untracked"),
  };
}

export default function ChangesSidebar(): React.JSX.Element {
  const { status, statusLoading, stage, unstage, discard } = useGit();
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [filter, setFilter] = useState("");

  if (!status) {
    return (
      <div className="panel-placeholder">
        {statusLoading ? <Spinner label="상태를 불러오는 중..." /> : "저장소 상태를 읽을 수 없습니다"}
      </div>
    );
  }

  const groups = groupEntries(status.entries);
  const query = filter.trim().toLowerCase();
  const f = (entries: StatusEntry[]): StatusEntry[] =>
    query ? entries.filter((e) => e.path.toLowerCase().includes(query)) : entries;
  const paths = (entries: StatusEntry[]): string[] => entries.map((e) => e.path);

  const requestDiscard = (path: string): void => {
    setConfirm({
      title: "변경 버리기",
      message: `"${path}"의 변경을 버립니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "버리기",
      onConfirm: () => {
        setConfirm(null);
        discard([path]);
      },
    });
  };

  return (
    <div className="changes-sidebar">
      <ChangesFilter value={filter} onChange={setFilter} />
      <div className="changes-files">
        {status.changedCount === 0 ? (
          <div className="panel-placeholder">변경 사항이 없습니다</div>
        ) : (
          <>
            <FileSection
              title="충돌"
              entries={f(groups.conflicted)}
              staged={false}
              disabled
              onDiscard={requestDiscard}
            />
            <FileSection
              title="스테이지됨"
              entries={f(groups.staged)}
              staged={true}
              actionLabel="모두 언스테이지"
              onAction={() => unstage(paths(groups.staged))}
              onDiscard={requestDiscard}
            />
            <FileSection
              title="변경됨"
              entries={f(groups.unstaged)}
              staged={false}
              canDiscard
              actionLabel="모두 스테이지"
              onAction={() => stage(paths(groups.unstaged))}
              onDiscard={requestDiscard}
            />
            <FileSection
              title="추적 안 됨"
              entries={f(groups.untracked)}
              staged={false}
              canDiscard
              actionLabel="모두 스테이지"
              onAction={() => stage(paths(groups.untracked))}
              onDiscard={requestDiscard}
            />
          </>
        )}
      </div>
      <CommitBox status={status} />
      {confirm && <ConfirmDialog request={confirm} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
