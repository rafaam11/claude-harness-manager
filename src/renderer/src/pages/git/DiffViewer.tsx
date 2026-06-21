// DT_GitManager에서 흡수. Changes 모드 우측: 선택 파일의 diff(useGit Context 사용).
import { useGit } from "./GitContext";
import Spinner from "./Spinner";
import DiffBody, { fileTitle } from "./DiffBody";

export default function DiffViewer(): React.JSX.Element {
  const { selected, diff, diffLoading } = useGit();

  if (!selected) {
    return <div className="panel-placeholder">파일을 선택하면 diff가 표시됩니다</div>;
  }
  if (diffLoading) {
    return (
      <div className="panel-placeholder">
        <Spinner label="diff 불러오는 중..." />
      </div>
    );
  }
  if (!diff) {
    return <div className="panel-placeholder">파일을 선택하면 diff가 표시됩니다</div>;
  }
  if (!diff.ok) {
    return <div className="panel-placeholder error">{diff.message}</div>;
  }
  if (!diff.file) {
    return <div className="panel-placeholder">표시할 변경 내용이 없습니다</div>;
  }

  return (
    <div className="diff-viewer">
      <div className="diff-file-header" title={fileTitle(diff.file)}>
        {fileTitle(diff.file)}
      </div>
      <DiffBody file={diff.file} />
    </div>
  );
}
