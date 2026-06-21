// DT_GitManager에서 흡수. stage/unstage/discard(파괴적, 호출 전 사용자 확인 필요).
import type { GitActionResult } from '@shared/types'
import { execGit, getRepoStatus, gitErrorMessage } from './GitService.js'

// Conservative cap so a large selection stays well under the OS argument limit.
const MAX_PATHS_PER_CALL = 50

/** Runs `git <baseArgs> -- <paths>` in chunks to avoid the OS argument-length limit. */
async function execGitChunked(repoPath: string, baseArgs: string[], paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += MAX_PATHS_PER_CALL) {
    const chunk = paths.slice(i, i + MAX_PATHS_PER_CALL)
    await execGit(repoPath, [...baseArgs, '--', ...chunk])
  }
}

/** Stages the given paths. `git add` handles modified, deleted, and untracked files alike. */
export async function stageFiles(repoPath: string, paths: string[]): Promise<GitActionResult> {
  if (paths.length === 0) return { ok: true }
  try {
    await execGitChunked(repoPath, ['add'], paths)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}

/**
 * Unstages the given paths. Uses `restore --staged` once a commit exists, or
 * `rm --cached` before the first commit (where there is no HEAD to restore from).
 * Renamed entries also unstage their original path so the rename is fully undone.
 */
export async function unstageFiles(repoPath: string, paths: string[]): Promise<GitActionResult> {
  if (paths.length === 0) return { ok: true }
  try {
    const status = await getRepoStatus(repoPath)
    const targets = new Set(paths)
    const originals = status.entries
      .filter((e) => e.kind === 'renamed' && e.origPath && targets.has(e.path))
      .map((e) => e.origPath as string)
    const allPaths = [...paths, ...originals]

    if (status.oid === null) {
      await execGitChunked(repoPath, ['rm', '--cached'], allPaths)
    } else {
      await execGitChunked(repoPath, ['restore', '--staged'], allPaths)
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}

/**
 * Discards working-tree changes (destructive). Tracked files are restored from
 * the index via `git restore`; untracked files are deleted via `git clean -f -d`.
 * Callers must confirm with the user before invoking this.
 */
export async function discardFiles(repoPath: string, paths: string[]): Promise<GitActionResult> {
  if (paths.length === 0) return { ok: true }
  try {
    const status = await getRepoStatus(repoPath)
    const untrackedSet = new Set(
      status.entries.filter((e) => e.kind === 'untracked').map((e) => e.path)
    )
    const untracked = paths.filter((p) => untrackedSet.has(p))
    const tracked = paths.filter((p) => !untrackedSet.has(p))

    if (tracked.length) await execGitChunked(repoPath, ['restore'], tracked)
    if (untracked.length) await execGitChunked(repoPath, ['clean', '-f', '-d'], untracked)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
