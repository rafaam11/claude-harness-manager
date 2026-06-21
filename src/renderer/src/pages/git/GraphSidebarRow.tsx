// DT_GitManager에서 흡수. 좌측 히스토리 행(레인 거터 + 아바타 + 컬러 ref + 제목 + 시각).
import type { CommitNode, RefDecoration } from "@shared/types";
import { relativeTime } from "../../git/relativeTime";
import { laneColor } from "../../git/graphMetrics";
import { avatarColor, initial } from "../../git/initialsAvatar";

function RefLabel({ deco, color }: { deco: RefDecoration; color: string }): React.JSX.Element {
  if (deco.kind === "head") {
    return <span className="gg-ref head">HEAD</span>;
  }
  const style = deco.kind === "branch" ? { color, borderColor: color } : undefined;
  return (
    <span className={`gg-ref ${deco.kind}`} style={style}>
      {deco.name}
    </span>
  );
}

interface GraphSidebarRowProps {
  commit: CommitNode;
  top: number;
  rowHeight: number;
  gutterWidth: number;
  colorIndex: number;
  selected: boolean;
  isHead: boolean;
  muted: boolean;
  onSelect: (oid: string) => void;
  onContext: (e: React.MouseEvent, commit: CommitNode) => void;
}

export default function GraphSidebarRow({
  commit,
  top,
  rowHeight,
  gutterWidth,
  colorIndex,
  selected,
  isHead,
  muted,
  onSelect,
  onContext,
}: GraphSidebarRowProps): React.JSX.Element {
  const cls = ["history-row"];
  if (selected) cls.push("selected");
  if (muted) cls.push("muted");
  if (isHead) cls.push("head");
  const color = laneColor(colorIndex);

  return (
    <div
      className={cls.join(" ")}
      style={{ top, height: rowHeight, paddingLeft: gutterWidth }}
      onClick={() => onSelect(commit.oid)}
      onContextMenu={(e) => onContext(e, commit)}
    >
      <span
        className="commit-avatar"
        style={{ background: avatarColor(commit.authorEmail || commit.authorName) }}
        title={commit.authorName}
      >
        {initial(commit.authorName)}
      </span>
      {commit.refs.length > 0 && (
        <span className="gg-refs">
          {commit.refs.map((deco, i) => (
            <RefLabel key={i} deco={deco} color={color} />
          ))}
        </span>
      )}
      <span className="history-subject" title={commit.subject}>
        {commit.subject}
      </span>
      <span className="history-time">{relativeTime(commit.authorTime)}</span>
    </div>
  );
}
