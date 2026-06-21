// DT_GitManager에서 흡수. 그래프 레인/행 기하 + 브랜치 색상 팔레트(순수).
/** GitHub Primer-toned hues cycled by branch color index (readable on light + dark). */
export const PALETTE = [
  '#4493f8',
  '#3fb950',
  '#d29922',
  '#a371f7',
  '#39c5cf',
  '#f85149',
  '#db61a2',
  '#e3956a'
]

export const laneColor = (colorIndex: number): string => PALETTE[colorIndex % PALETTE.length]

export interface GraphMetrics {
  ROW_H: number
  LANE_W: number
  MAX_LANES: number
  /** total left gutter width reserved for the lanes of a graph with `laneCount` lanes */
  gutterWidth: (laneCount: number) => number
  /** x centre of a lane (clamped past MAX_LANES so deep histories stay readable) */
  laneX: (lane: number) => number
  /** y centre of a row */
  rowY: (row: number) => number
  laneColor: (colorIndex: number) => string
}

interface MetricsConfig {
  ROW_H: number
  LANE_W: number
  MAX_LANES: number
}

/** Builds a metrics object for a given row height, lane width, and lane clamp. */
export function createGraphMetrics({ ROW_H, LANE_W, MAX_LANES }: MetricsConfig): GraphMetrics {
  return {
    ROW_H,
    LANE_W,
    MAX_LANES,
    gutterWidth: (laneCount) => Math.min(Math.max(laneCount, 1), MAX_LANES) * LANE_W + 8,
    laneX: (lane) => Math.min(lane, MAX_LANES - 1) * LANE_W + LANE_W / 2,
    rowY: (row) => row * ROW_H + ROW_H / 2,
    laneColor
  }
}

/** Default metrics for the full-width graph view. */
export const defaultMetrics = createGraphMetrics({ ROW_H: 28, LANE_W: 14, MAX_LANES: 14 })

/** Compact metrics for the narrow left-panel history list (lanes folded at 6). */
export const compactMetrics = createGraphMetrics({ ROW_H: 26, LANE_W: 13, MAX_LANES: 6 })

// Backward-compatible named exports — the full-width GraphSvg imports these directly.
export const ROW_H = defaultMetrics.ROW_H
export const LANE_W = defaultMetrics.LANE_W
export const MAX_LANES = defaultMetrics.MAX_LANES
export const gutterWidth = defaultMetrics.gutterWidth
export const laneX = defaultMetrics.laneX
export const rowY = defaultMetrics.rowY
