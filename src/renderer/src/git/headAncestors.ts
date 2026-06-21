// DT_GitManager에서 흡수. HEAD에서 도달 가능한 조상 oid 집합(나머지는 그래프에서 흐리게 표시).
import type { CommitNode } from '@shared/types'

/**
 * Returns HEAD and all of its ancestors (following every parent transitively),
 * limited to the loaded commit set. Commits NOT in this set are shown muted in the
 * graph (they aren't reachable from the checked-out commit). Pure and deterministic.
 */
export function headAncestors(commits: CommitNode[], headOid: string | null): Set<string> {
  const result = new Set<string>()
  if (!headOid) return result
  const byOid = new Map(commits.map((c) => [c.oid, c]))
  const stack = [headOid]
  while (stack.length > 0) {
    const oid = stack.pop() as string
    if (result.has(oid)) continue
    result.add(oid)
    const commit = byOid.get(oid)
    if (commit) {
      for (const parent of commit.parents) {
        if (!result.has(parent)) stack.push(parent)
      }
    }
  }
  return result
}
