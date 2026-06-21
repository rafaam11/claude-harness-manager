// DT_GitManager에서 흡수. 커밋 DAG(git log --all --topo-order)를 GraphPayload로 로드.
import type { GraphPayload } from '@shared/types'
import { execGit, execGitAllowingCodes, gitErrorMessage } from './GitService.js'
import { parseGraphLog } from './parseGraphLog.js'

// Seven NUL-separated fields per commit; %x00 emits a literal NUL in git's format.
const LOG_FORMAT = '--format=%H%x00%P%x00%D%x00%an%x00%ae%x00%at%x00%s'
const DEFAULT_LIMIT = 2000

/** Remote names, used to classify `origin/foo` decorations as remote-tracking branches. */
async function getRemotes(repoPath: string): Promise<Set<string>> {
  try {
    const out = await execGit(repoPath, ['remote'])
    return new Set(
      out
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean)
    )
  } catch {
    return new Set()
  }
}

/** Resolves HEAD's oid, or null on an unborn branch / empty repo (rev-parse exits 128). */
async function getHeadOid(repoPath: string): Promise<string | null> {
  try {
    const out = await execGitAllowingCodes(repoPath, ['rev-parse', '--verify', 'HEAD'], [128])
    return out.trim() || null
  } catch {
    return null
  }
}

/**
 * Loads the commit DAG across all refs in topo order (parents after children).
 * Requests one extra commit beyond `limit` to detect truncation. Returns an empty
 * graph (not an error) for a repo with no commits yet.
 */
export async function getGraph(repoPath: string, limit = DEFAULT_LIMIT): Promise<GraphPayload> {
  try {
    const remotes = await getRemotes(repoPath)
    const raw = await execGit(repoPath, [
      '-c',
      'core.quotePath=false',
      'log',
      '--all',
      '--topo-order',
      '--decorate',
      '--no-color',
      `--max-count=${limit + 1}`,
      LOG_FORMAT
    ])
    const all = parseGraphLog(raw, remotes)
    const truncated = all.length > limit
    const commits = truncated ? all.slice(0, limit) : all
    const headOid = await getHeadOid(repoPath)
    return { ok: true, commits, headOid, truncated }
  } catch (error) {
    const message = gitErrorMessage(error)
    // empty repo / unborn branch: `git log` exits 128 with one of these messages
    if (/does not have any commits yet|bad default revision|unknown revision/i.test(message)) {
      return { ok: true, commits: [], headOid: null, truncated: false }
    }
    return { ok: false, message }
  }
}
