// DT_GitManager에서 흡수. `git diff-tree --name-status -z` 파서(순수).
import type { CommitFileChange, CommitFileStatus } from '@shared/types'

const KNOWN: CommitFileStatus[] = ['A', 'M', 'D', 'R', 'C', 'T']

function toStatus(letter: string): CommitFileStatus {
  return (KNOWN as string[]).includes(letter) ? (letter as CommitFileStatus) : 'M'
}

/**
 * Parses `git diff-tree --name-status -z` output (NUL-separated tokens). Each entry
 * is a status token followed by one path, except renames/copies (status starts with
 * R or C, carries a similarity score) which are followed by old then new path.
 */
export function parseNameStatusZ(output: string): CommitFileChange[] {
  const tokens = output.split('\0')
  const files: CommitFileChange[] = []
  let i = 0
  while (i < tokens.length) {
    const raw = tokens[i++]
    if (!raw) continue
    const letter = raw[0]
    if (letter === 'R' || letter === 'C') {
      const origPath = tokens[i++] ?? ''
      const path = tokens[i++] ?? ''
      files.push({ status: toStatus(letter), path, origPath })
    } else {
      const path = tokens[i++] ?? ''
      files.push({ status: toStatus(letter), path, origPath: null })
    }
  }
  return files
}
