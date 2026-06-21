// DT_GitManager에서 흡수. 파싱된 diff를 렌더(Changes/Commit 흐름 공용, store 비의존).
import type { DiffFile } from "@shared/types";

const MAX_LINES = 5000;

/** Display title for a diff file: "old → new" for renames, else the path. */
export function fileTitle(file: DiffFile): string {
  if (file.from && file.to && file.from !== file.to) return `${file.from} → ${file.to}`;
  return file.to ?? file.from ?? "";
}

export default function DiffBody({ file }: { file: DiffFile }): React.JSX.Element {
  if (file.binary) {
    return <div className="panel-placeholder">바이너리 파일 — diff를 표시하지 않습니다</div>;
  }
  if (file.hunks.length === 0) {
    return <div className="panel-placeholder">표시할 변경 내용이 없습니다</div>;
  }

  const total = file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
  if (total > MAX_LINES) {
    return (
      <div className="panel-placeholder">
        변경이 너무 큽니다 ({total.toLocaleString()}줄) — 에디터에서 확인하세요
      </div>
    );
  }

  return (
    <div className="diff-body">
      {file.hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk">
          <div className="diff-hunk-header">{hunk.header}</div>
          {hunk.lines.map((line, li) => (
            <div key={li} className={`diff-line ${line.type}`}>
              <span className="diff-gutter">{line.oldLine ?? ""}</span>
              <span className="diff-gutter">{line.newLine ?? ""}</span>
              <span className="diff-sign">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </span>
              <span className="diff-text">{line.content}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
