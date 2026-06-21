// DT_GitManager에서 흡수. 커밋 메타데이터 + 변경 파일 목록 + 커밋의 단일 파일 diff.
import type {
  CommitDetail,
  CommitDetailResult,
  CommitDiffRequest,
  DiffResult
} from '@shared/types'
import { execGit, gitErrorMessage } from './GitService.js'
import { parseNameStatusZ } from './parseNameStatusZ.js'
import { mapDiff } from './diffMap.js'

const QUOTE = ['-c', 'core.quotePath=false']
// oid, parents, author-name, author-email, author-time, commit-time, subject, body
const SHOW_FORMAT = '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%ct%x00%s%x00%b'

/** Loads a commit's metadata plus its changed-file list (first-parent diff). */
export async function getCommitDetail(repoPath: string, oid: string): Promise<CommitDetailResult> {
  try {
    const meta = await execGit(repoPath, ['show', '--no-patch', SHOW_FORMAT, oid])
    const f = meta.split('\0')
    const parents = f[1] ? f[1].split(' ') : []
    const names = await execGit(repoPath, [
      ...QUOTE,
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-M',
      '-z',
      '--root',
      '--first-parent',
      oid
    ])
    const detail: CommitDetail = {
      oid: f[0],
      parents,
      authorName: f[2] ?? '',
      authorEmail: f[3] ?? '',
      authorTime: Number(f[4]),
      commitTime: Number(f[5]),
      subject: f[6] ?? '',
      body: (f[7] ?? '').replace(/\n+$/, ''),
      files: parseNameStatusZ(names),
      isMerge: parents.length > 1
    }
    return { ok: true, detail }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}

/** Diffs one file of a commit against its (first) parent; root commits diff vs the empty tree. */
export async function getCommitDiff(repoPath: string, req: CommitDiffRequest): Promise<DiffResult> {
  try {
    const args =
      req.parentOid === null
        ? [...QUOTE, 'show', '--no-color', '--format=', '-M', req.oid, '--', req.path]
        : [...QUOTE, 'diff', '--no-color', '-M', req.parentOid, req.oid, '--', req.path]
    const raw = await execGit(repoPath, args)
    return { ok: true, file: mapDiff(raw) }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
