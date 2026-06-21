// DT_GitManager에서 흡수. `git diff` 원시 출력을 직렬화 가능한 DiffFile로 매핑(parse-diff 의존).
import parseDiff from 'parse-diff'
import type { DiffFile, DiffFileKind, DiffLine, DiffHunk } from '@shared/types'

const NO_NEWLINE = '\\ No newline at end of file'
const NUL = String.fromCharCode(0)

function normalizePath(path: string | undefined): string | null {
  if (!path || path === '/dev/null') return null
  return path
}

/** Drops the leading +/-/space sign that git diff prefixes every content line with. */
function stripSign(content: string): string {
  return content.length > 0 ? content.slice(1) : content
}

function mapLines(changes: parseDiff.Change[]): DiffLine[] {
  const lines: DiffLine[] = []
  for (const change of changes) {
    // parse-diff duplicates the previous change with this marker as content; skip it.
    if (change.content.startsWith(NO_NEWLINE)) continue
    if (change.type === 'add') {
      lines.push({ type: 'add', content: stripSign(change.content), oldLine: null, newLine: change.ln })
    } else if (change.type === 'del') {
      lines.push({ type: 'del', content: stripSign(change.content), oldLine: change.ln, newLine: null })
    } else {
      lines.push({
        type: 'context',
        content: stripSign(change.content),
        oldLine: change.ln1,
        newLine: change.ln2
      })
    }
  }
  return lines
}

function classify(file: parseDiff.File, binary: boolean, from: string | null, to: string | null): DiffFileKind {
  if (binary) return 'binary'
  if (file.new) return 'added'
  if (file.deleted) return 'deleted'
  if (from && to && from !== to) return 'renamed'
  return 'modified'
}

/**
 * Maps the raw output of `git diff [--cached] -- <path>` into a serializable DiffFile.
 * Returns null when the diff is empty (no changes).
 */
export function mapDiff(raw: string): DiffFile | null {
  const files = parseDiff(raw)
  if (files.length === 0) return null

  const file = files[0]
  // `git diff --no-index` against /dev/null dumps raw bytes for an untracked
  // binary instead of "Binary files differ", so detect NUL bytes too.
  const binary =
    /^Binary files .* differ$/m.test(raw) ||
    /^GIT binary patch$/m.test(raw) ||
    raw.includes(NUL)
  const from = normalizePath(file.from)
  const to = normalizePath(file.to)

  const hunks: DiffHunk[] = file.chunks.map((chunk) => ({
    header: chunk.content,
    lines: mapLines(chunk.changes)
  }))

  return {
    from,
    to,
    kind: classify(file, binary, from, to),
    binary,
    hunks,
    additions: file.additions,
    deletions: file.deletions
  }
}
