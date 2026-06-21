// DT_GitManager에서 흡수. 단일 파일 diff(워킹트리/스테이지/untracked)를 파싱해 반환.
import type { DiffRequest, DiffResult } from '@shared/types'
import { execGit, execGitAllowingCodes, gitErrorMessage } from './GitService.js'
import { mapDiff } from './diffMap.js'

/**
 * Produces a parsed diff for a single file. Untracked files are diffed against
 * /dev/null with `--no-index` (which exits 1 when content differs); tracked
 * files use `git diff` or `git diff --cached` depending on the selected group.
 */
export async function getDiff(repoPath: string, request: DiffRequest): Promise<DiffResult> {
  // `-c core.quotePath=false` keeps non-ASCII / spaced paths literal instead of
  // octal-escaped, so the diff header matches the porcelain v2 (-z) paths.
  const quote = ['-c', 'core.quotePath=false']
  try {
    let raw: string
    if (request.kind === 'untracked') {
      raw = await execGitAllowingCodes(
        repoPath,
        [...quote, 'diff', '--no-color', '--no-index', '--', '/dev/null', request.path],
        [1]
      )
    } else {
      const args = [...quote, 'diff', '--no-color', '-M']
      if (request.staged) args.push('--cached')
      args.push('--', request.path)
      raw = await execGit(repoPath, args)
    }
    return { ok: true, file: mapDiff(raw) }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
