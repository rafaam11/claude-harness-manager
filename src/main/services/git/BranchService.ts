// DT_GitManager에서 흡수. for-each-ref로 로컬/원격 브랜치 목록(최근 커밋순).
import type { BranchInfo, BranchListResult } from '@shared/types'
import { execGit, gitErrorMessage } from './GitService.js'

// one record per line; fields are NUL-separated (branch names cannot contain newlines)
const BRANCH_FORMAT =
  '%(HEAD)%00%(refname)%00%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(committerdate:unix)'

/** Parses `git for-each-ref` output (see BRANCH_FORMAT) into branch records. Pure. */
export function parseBranches(raw: string): BranchInfo[] {
  const branches: BranchInfo[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const [head, refName, shortName, , upstream, date] = line.split('\x00')
    if (refName === undefined || shortName === undefined) continue
    const kind = refName.startsWith('refs/heads/') ? 'local' : 'remote'
    // skip the remote symbolic HEAD (e.g. refs/remotes/origin/HEAD -> origin/main)
    if (kind === 'remote' && refName.endsWith('/HEAD')) continue
    // for a remote ref, drop the leading remote-name segment to get the local branch name
    const localName = kind === 'local' ? shortName : shortName.slice(shortName.indexOf('/') + 1)
    branches.push({
      refName,
      shortName,
      localName,
      kind,
      isCurrent: head === '*',
      committerDate: Number.parseInt(date ?? '', 10) || 0,
      upstream: upstream ? upstream : null
    })
  }
  return branches
}

/** Lists local and remote branches, newest-commit first. */
export async function listBranches(repoPath: string): Promise<BranchListResult> {
  try {
    const raw = await execGit(repoPath, [
      '-c',
      'core.quotePath=false',
      'for-each-ref',
      '--sort=-committerdate',
      `--format=${BRANCH_FORMAT}`,
      'refs/heads',
      'refs/remotes'
    ])
    return { ok: true, branches: parseBranches(raw) }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
