// DT_GitManager에서 흡수. History 모드 우측: 커밋 메타 + 변경 파일 목록 + 파일 diff(useGit).
import type { CommitFileChange } from "@shared/types";
import { useGit } from "./GitContext";
import { relativeTime } from "../../git/relativeTime";
import Spinner from "./Spinner";
import DiffBody, { fileTitle } from "./DiffBody";

function statusClass(status: CommitFileChange["status"]): string {
  if (status === "A") return "file-status untracked";
  if (status === "D") return "file-status unmerged";
  return "file-status";
}

export default function CommitDetail(): React.JSX.Element {
  const { detail, detailLoading, selectedFile, fileDiff, fileDiffLoading, selectCommitFile } =
    useGit();

  if (detailLoading) {
    return (
      <div className="panel-placeholder">
        <Spinner label="커밋 정보 불러오는 중..." />
      </div>
    );
  }
  if (!detail) {
    return <div className="panel-placeholder">커밋을 선택하세요</div>;
  }

  return (
    <div className="commit-detail">
      <div className="commit-meta">
        <div className="commit-subject">{detail.subject}</div>
        <div className="commit-meta-line">
          <span className="graph-hash">{detail.oid.slice(0, 7)}</span>
          <span>{detail.authorName}</span>
          <span>{relativeTime(detail.authorTime)}</span>
          {detail.isMerge && <span className="commit-merge-tag">merge</span>}
        </div>
        {detail.body && <pre className="commit-body">{detail.body}</pre>}
      </div>

      <div className="commit-files">
        {detail.files.length === 0 ? (
          <div className="panel-placeholder">변경된 파일이 없습니다</div>
        ) : (
          detail.files.map((file) => (
            <div
              key={file.path}
              className={selectedFile === file.path ? "commit-file active" : "commit-file"}
              onClick={() => selectCommitFile(file)}
            >
              <span className={statusClass(file.status)}>{file.status}</span>
              <span className="commit-file-name" title={file.path}>
                {file.origPath ? `${file.origPath} → ${file.path}` : file.path}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="commit-diff">
        {!selectedFile ? (
          <div className="panel-placeholder">파일을 선택하면 diff가 표시됩니다</div>
        ) : fileDiffLoading ? (
          <div className="panel-placeholder">
            <Spinner label="diff 불러오는 중..." />
          </div>
        ) : !fileDiff ? (
          <div className="panel-placeholder">파일을 선택하면 diff가 표시됩니다</div>
        ) : !fileDiff.ok ? (
          <div className="panel-placeholder error">{fileDiff.message}</div>
        ) : !fileDiff.file ? (
          <div className="panel-placeholder">표시할 변경 내용이 없습니다</div>
        ) : (
          <>
            <div className="diff-file-header" title={fileTitle(fileDiff.file)}>
              {fileTitle(fileDiff.file)}
            </div>
            <DiffBody file={fileDiff.file} />
          </>
        )}
      </div>
    </div>
  );
}
