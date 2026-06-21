// DT_GitManager에서 흡수. 커스텀 포맷 `git log` 출력을 CommitNode[]로 파싱(순수).
import type { CommitNode, RefDecoration } from '@shared/types'

const NUL = String.fromCharCode(0)
const HEAD_ARROW = 'HEAD -> '
const TAG_PREFIX = 'tag: '

/**
 * Classifies a single decoration token (a branch-ish name) as a remote-tracking
 * branch or a local branch. A token is remote when its first path segment is a
 * known remote name (e.g. `origin/main` with remote `origin`); otherwise it is a
 * local branch, so slashed local names like `feature/login` stay branches.
 */
function classifyBranch(name: string, remotes: Set<string>): RefDecoration {
  const slash = name.indexOf('/')
  if (slash > 0 && remotes.has(name.slice(0, slash))) {
    return { kind: 'remote', name }
  }
  return { kind: 'branch', name }
}

/**
 * Parses a `%D` decoration string ("HEAD -> main, origin/main, tag: v1.0, ...")
 * into structured refs. `HEAD -> X` yields both the HEAD pointer and branch X;
 * `tag: X` yields a tag; remote HEAD symrefs like origin/HEAD are dropped as noise.
 */
export function parseRefDecorations(deco: string, remotes: Set<string>): RefDecoration[] {
  const refs: RefDecoration[] = []
  for (const raw of deco.split(',')) {
    const token = raw.trim()
    if (!token) continue
    if (token === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' })
    } else if (token.startsWith(HEAD_ARROW)) {
      refs.push({ kind: 'head', name: 'HEAD' })
      refs.push(classifyBranch(token.slice(HEAD_ARROW.length), remotes))
    } else if (token.startsWith(TAG_PREFIX)) {
      refs.push({ kind: 'tag', name: token.slice(TAG_PREFIX.length) })
    } else if (token.endsWith('/HEAD')) {
      // e.g. origin/HEAD: a remote default-branch symref, not a real ref
      continue
    } else {
      refs.push(classifyBranch(token, remotes))
    }
  }
  return refs
}

/**
 * Maps the raw output of a custom-format git log (one record per line, with the
 * seven fields oid/parents/decoration/author-name/author-email/author-time/subject
 * separated by NUL) into ordered commit nodes. The LogService builds the matching
 * --format string. Input is already in git topo order (children before parents).
 */
export function parseGraphLog(raw: string, remotes: Set<string> = new Set()): CommitNode[] {
  const commits: CommitNode[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    const fields = line.split(NUL)
    if (fields.length < 7) continue
    const [oid, parents, deco, authorName, authorEmail, authorTime, subject] = fields
    commits.push({
      oid,
      parents: parents ? parents.split(' ') : [],
      refs: parseRefDecorations(deco, remotes),
      authorName,
      authorEmail,
      authorTime: Number(authorTime),
      subject
    })
  }
  return commits
}
