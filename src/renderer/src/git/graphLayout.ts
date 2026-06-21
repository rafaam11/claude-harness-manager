// DT_GitManager에서 흡수. topo-order 커밋에 레인(열)을 배정하고 부모 엣지를 라우팅(순수).
import type { CommitNode } from '@shared/types'

export interface LaneCommit {
  oid: string
  row: number
  lane: number
  colorIndex: number
}

export interface GraphEdge {
  /** child row (smaller index, higher on screen) */
  fromRow: number
  /** parent row (larger index); commits.length when the parent is absent (truncated) */
  toRow: number
  fromLane: number
  toLane: number
  colorIndex: number
  /** true for a merge's 2nd+ parent edge */
  isMerge: boolean
}

export interface GraphLayout {
  nodes: LaneCommit[]
  edges: GraphEdge[]
  laneCount: number
}

/**
 * Assigns each commit a lane (column) and routes parent edges, in a single
 * top-to-bottom pass over topo-ordered commits (children before parents).
 *
 * A lane slot holds the oid of the commit expected to occupy that column next.
 * When a commit is reached its slot is already reserved by whichever child first
 * referenced it; the commit hands its lane and color to its first parent (keeping
 * a branch's mainline a straight, single-colored column), while extra parents of a
 * merge fan out into fresh lanes. Slots are freed the moment a commit is consumed,
 * so lanes are densely reused. Pure and deterministic: identical input yields an
 * identical layout, so prepending a new head leaves prior commits' lanes stable.
 */
export function layoutGraph(commits: CommitNode[]): GraphLayout {
  const rowOf = new Map<string, number>()
  commits.forEach((commit, i) => rowOf.set(commit.oid, i))

  const lanes: (string | null)[] = []
  const colorOf = new Map<string, number>()
  let nextColor = 0
  let maxLane = 0
  const nodes: LaneCommit[] = []
  const edges: GraphEdge[] = []
  const missingRow = commits.length

  const firstFreeLane = (): number => {
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) return i
    }
    return lanes.length
  }

  const claim = (lane: number, oid: string): void => {
    lanes[lane] = oid
    if (lane > maxLane) maxLane = lane
  }

  const placeParent = (oid: string, preferred: number, inheritColor: number): number => {
    const existing = lanes.indexOf(oid)
    if (existing !== -1) {
      if (!colorOf.has(oid)) colorOf.set(oid, inheritColor)
      return existing
    }
    const lane = preferred >= lanes.length || lanes[preferred] === null ? preferred : firstFreeLane()
    claim(lane, oid)
    if (!colorOf.has(oid)) colorOf.set(oid, inheritColor)
    return lane
  }

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]
    let myLane = lanes.indexOf(commit.oid)
    if (myLane === -1) {
      // a branch tip not referenced by any earlier child: new lane, new color
      myLane = firstFreeLane()
      claim(myLane, commit.oid)
      if (!colorOf.has(commit.oid)) colorOf.set(commit.oid, nextColor++)
    }
    const color = colorOf.get(commit.oid) ?? 0
    nodes.push({ oid: commit.oid, row, lane: myLane, colorIndex: color })
    lanes[myLane] = null // consume this commit, freeing its slot

    const parents = commit.parents
    if (parents.length === 0) continue

    // first parent continues this commit's lane and color
    const p0Lane = placeParent(parents[0], myLane, color)
    edges.push({
      fromRow: row,
      toRow: rowOf.get(parents[0]) ?? missingRow,
      fromLane: myLane,
      toLane: p0Lane,
      colorIndex: color,
      isMerge: false
    })

    // extra parents (merge) fan into fresh lanes with their own colors
    for (let k = 1; k < parents.length; k++) {
      const pk = parents[k]
      const lane = placeParent(pk, firstFreeLane(), nextColor++)
      edges.push({
        fromRow: row,
        toRow: rowOf.get(pk) ?? missingRow,
        fromLane: myLane,
        toLane: lane,
        colorIndex: colorOf.get(pk) ?? 0,
        isMerge: true
      })
    }
  }

  return { nodes, edges, laneCount: nodes.length === 0 ? 0 : maxLane + 1 }
}
