// DT_GitManager에서 흡수. 변경 파일 행 그룹(useGit Context 사용, repoId 인자 제거).
import type { StatusEntry } from "@shared/types";
import { RotateCcw } from "lucide-react";
import { useGit } from "./GitContext";

/** The status character shown for a file row (index vs worktree side). */
export function statusChar(entry: StatusEntry, staged: boolean): string {
  if (entry.kind === "untracked") return "?";
  if (entry.kind === "unmerged") return "U";
  const code = staged ? entry.indexStatus : entry.worktreeStatus;
  return code === "." ? " " : code;
}

function FileRow({
  entry,
  staged,
  disabled,
  canDiscard,
  onDiscard,
}: {
  entry: StatusEntry;
  staged: boolean;
  disabled: boolean;
  canDiscard: boolean;
  onDiscard: (path: string) => void;
}): React.JSX.Element {
  const { selectFile, stage, unstage, selected } = useGit();
  const active = selected?.path === entry.path && selected?.staged === staged;

  const toggle = (): void => {
    if (staged) unstage([entry.path]);
    else stage([entry.path]);
  };

  return (
    <div
      className={active ? "file-row active" : "file-row"}
      onClick={() => selectFile(entry.path, staged, entry.kind)}
      title={entry.origPath ? `${entry.origPath} → ${entry.path}` : entry.path}
    >
      <input
        type="checkbox"
        className="file-check"
        checked={staged}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={toggle}
      />
      <span className={`file-status ${entry.kind}`}>{statusChar(entry, staged)}</span>
      <span className="file-name">{entry.path}</span>
      {canDiscard && (
        <button
          className="file-discard"
          title="변경 버리기 (되돌릴 수 없음)"
          onClick={(e) => {
            e.stopPropagation();
            onDiscard(entry.path);
          }}
        >
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  );
}

export default function FileSection({
  title,
  entries,
  staged,
  disabled = false,
  canDiscard = false,
  onDiscard,
  actionLabel,
  onAction,
}: {
  title: string;
  entries: StatusEntry[];
  staged: boolean;
  disabled?: boolean;
  canDiscard?: boolean;
  onDiscard: (path: string) => void;
  actionLabel?: string;
  onAction?: () => void;
}): React.JSX.Element | null {
  if (entries.length === 0) return null;
  return (
    <div className="file-section">
      <div className="file-section-header">
        <span>
          {title} <span className="file-section-count">{entries.length}</span>
        </span>
        {actionLabel && onAction && (
          <button className="section-action" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
      {entries.map((entry) => (
        <FileRow
          key={entry.path}
          entry={entry}
          staged={staged}
          disabled={disabled}
          canDiscard={canDiscard}
          onDiscard={onDiscard}
        />
      ))}
    </div>
  );
}
