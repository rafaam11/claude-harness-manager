// DT_GitManager에서 흡수. 보이는 행 범위의 레인 노드/부모 엣지를 SVG로 렌더(순수 렌더).
import type { GraphLayout } from "../../git/graphLayout";
import { defaultMetrics, type GraphMetrics } from "../../git/graphMetrics";

interface GraphSvgProps {
  layout: GraphLayout;
  first: number;
  last: number;
  total: number;
  headOid: string | null;
  metrics?: GraphMetrics;
  topOffset?: number;
}

/**
 * Builds an edge path with the lane change localized to a single short curve
 * (VS Code Git Graph style) instead of a long diagonal.
 */
function edgePath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  isMerge: boolean,
  corner: number,
): string {
  if (x0 === x1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const len = Math.min(corner, Math.abs(y1 - y0));
  if (isMerge) {
    const yb = y0 + len;
    return `M ${x0} ${y0} C ${x0} ${y0 + len / 2} ${x1} ${yb - len / 2} ${x1} ${yb} L ${x1} ${y1}`;
  }
  const yt = y1 - len;
  return `M ${x0} ${y0} L ${x0} ${yt} C ${x0} ${yt + len / 2} ${x1} ${y1 - len / 2} ${x1} ${y1}`;
}

export default function GraphSvg({
  layout,
  first,
  last,
  total,
  headOid,
  metrics = defaultMetrics,
  topOffset = 0,
}: GraphSvgProps): React.JSX.Element {
  const { ROW_H, gutterWidth, laneX, rowY, laneColor } = metrics;
  const corner = ROW_H * 0.6;
  const width = gutterWidth(layout.laneCount);
  const visibleEdges = layout.edges.filter((e) => e.toRow >= first && e.fromRow <= last);
  const visibleNodes = layout.nodes.slice(first, last + 1);

  return (
    <svg
      className="graph-svg"
      width={width}
      height={total * ROW_H + topOffset}
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
    >
      {visibleEdges.map((e) => (
        <path
          key={`${e.fromRow}-${e.fromLane}-${e.toRow}-${e.toLane}-${e.isMerge ? "m" : "f"}`}
          d={edgePath(
            laneX(e.fromLane),
            rowY(e.fromRow) + topOffset,
            laneX(e.toLane),
            rowY(e.toRow) + topOffset,
            e.isMerge,
            corner,
          )}
          stroke={laneColor(e.colorIndex)}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {visibleNodes.map((n) => (
        <circle
          key={n.oid}
          className={n.oid === headOid ? "graph-node head" : "graph-node"}
          cx={laneX(n.lane)}
          cy={rowY(n.row) + topOffset}
          r={n.oid === headOid ? 5 : 4}
          fill={laneColor(n.colorIndex)}
        />
      ))}
    </svg>
  );
}
