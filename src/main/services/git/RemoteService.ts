// DT_GitManager에서 흡수 + 단순화. push/pull/fetch를 완료까지 대기 후 결과만 반환한다.
// 1차 흡수에서는 진행 이벤트 스트리밍/취소(opId/AbortController)를 쓰지 않으므로 제거했다.
import type { GitOpKind, GitOpResult } from '@shared/types'
import { execGit, gitErrorMessage } from './GitService.js'
import { spawnErrorMessage, spawnGit } from './spawnGit.js'

function argsFor(kind: GitOpKind): string[] {
  switch (kind) {
    case 'push':
      return ['push']
    case 'publish':
      // first push of a branch with no upstream: push HEAD to origin and set tracking
      return ['push', '-u', 'origin', 'HEAD']
    case 'pull':
      return ['pull']
    case 'fetch':
      return ['fetch', '--all']
  }
}

/**
 * Push args targeting the tracked upstream explicitly (e.g. `push origin HEAD:dev`), so a
 * branch whose name differs from its upstream still pushes — matching GitHub Desktop and
 * sidestepping push.default=simple's "branch name doesn't match upstream" refusal. Falls
 * back to a plain push when there is no upstream (the renderer routes that case to 'publish').
 */
async function pushArgs(repoPath: string): Promise<string[]> {
  try {
    const upstream = (await execGit(repoPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])).trim()
    const slash = upstream.indexOf('/')
    if (slash > 0) {
      const remote = upstream.slice(0, slash)
      const branch = upstream.slice(slash + 1)
      return ['push', remote, `HEAD:${branch}`]
    }
  } catch {
    // no upstream configured — fall through to a plain push
  }
  return argsFor('push')
}

/**
 * Runs a long-running remote operation to completion. Non-zero exits are reported
 * (with git's stderr verbatim) rather than thrown. No progress streaming / cancel.
 */
export async function runRemoteOp(repoPath: string, kind: GitOpKind): Promise<GitOpResult> {
  try {
    const args = kind === 'push' ? await pushArgs(repoPath) : argsFor(kind)
    const result = await spawnGit(repoPath, args)
    if (result.code === 0) {
      return { ok: true, output: result.stderr.trim() || result.stdout.trim() }
    }
    return { ok: false, code: result.code, message: spawnErrorMessage(result), canceled: false }
  } catch (error) {
    return { ok: false, code: null, message: gitErrorMessage(error), canceled: false }
  }
}
