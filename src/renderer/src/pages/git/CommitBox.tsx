// DT_GitManager에서 흡수. GitHub Desktop식 커밋 박스(요약 필수 + 설명). useGit 사용.
import { GitCommit } from "lucide-react";
import type { RepoStatus } from "@shared/types";
import { useGit } from "./GitContext";

export default function CommitBox({ status }: { status: RepoStatus }): React.JSX.Element {
  const { summary, description, setSummary, setDescription, commit } = useGit();

  const hasConflicts = status.conflicted > 0;
  const canCommit = status.staged > 0 && summary.trim() !== "" && !hasConflicts;
  const branch = status.detached ? "HEAD (detached)" : (status.branch ?? "HEAD");

  return (
    <div className="commit-box">
      {hasConflicts && (
        <div className="commit-warning">충돌을 먼저 해결한 뒤 커밋할 수 있습니다</div>
      )}
      <input
        className="commit-summary"
        placeholder="요약 (필수)"
        value={summary}
        disabled={hasConflicts}
        spellCheck={false}
        onChange={(e) => setSummary(e.target.value)}
      />
      <textarea
        className="commit-message"
        placeholder="설명"
        value={description}
        disabled={hasConflicts}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button className="commit-button" disabled={!canCommit} onClick={() => commit()}>
        <GitCommit size={14} />
        {branch}에 커밋{status.staged > 0 ? ` (${status.staged})` : ""}
      </button>
    </div>
  );
}
