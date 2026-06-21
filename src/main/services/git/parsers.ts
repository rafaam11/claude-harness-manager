// DT_GitManager에서 흡수. `git status --porcelain=v2 --branch -z` 파서(순수).
import type { RepoStatus, StatusEntry } from '@shared/types'

// porcelain v2 record patterns (path is the trailing free-form field)
const ORDINARY_RE = /^1 (..) \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/
const RENAME_RE = /^2 (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/
const UNMERGED_RE = /^u (..) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.*)$/

function emptyStatus(): RepoStatus {
  return {
    branch: null,
    detached: false,
    oid: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    changedCount: 0,
    entries: []
  }
}

function parseHeader(status: RepoStatus, record: string): void {
  const [key, ...rest] = record.slice(2).split(' ')
  const value = rest.join(' ')
  switch (key) {
    case 'branch.oid':
      status.oid = value === '(initial)' ? null : value
      break
    case 'branch.head':
      if (value === '(detached)') {
        status.detached = true
        status.branch = null
      } else {
        status.branch = value
      }
      break
    case 'branch.upstream':
      status.upstream = value
      break
    case 'branch.ab': {
      const match = value.match(/^\+(\d+) -(\d+)$/)
      if (match) {
        status.ahead = Number(match[1])
        status.behind = Number(match[2])
      }
      break
    }
  }
}

/**
 * Parses `git status --porcelain=v2 --branch -z` output.
 * Records are NUL-terminated; a rename record ("2") is followed by
 * one extra NUL-separated field holding the original path.
 */
export function parseStatusV2(output: string): RepoStatus {
  const status = emptyStatus()
  const tokens = output.split('\0')

  for (let i = 0; i < tokens.length; i++) {
    const record = tokens[i]
    if (!record) continue

    if (record.startsWith('# ')) {
      parseHeader(status, record)
      continue
    }

    let entry: StatusEntry | null = null
    switch (record[0]) {
      case '1': {
        const m = record.match(ORDINARY_RE)
        if (m) {
          entry = {
            path: m[2],
            origPath: null,
            indexStatus: m[1][0],
            worktreeStatus: m[1][1],
            kind: 'tracked'
          }
        }
        break
      }
      case '2': {
        const m = record.match(RENAME_RE)
        if (m) {
          // the original path is the next NUL-separated token
          const origPath = tokens[++i] ?? null
          entry = {
            path: m[2],
            origPath,
            indexStatus: m[1][0],
            worktreeStatus: m[1][1],
            kind: 'renamed'
          }
        }
        break
      }
      case 'u': {
        const m = record.match(UNMERGED_RE)
        if (m) {
          entry = {
            path: m[2],
            origPath: null,
            indexStatus: m[1][0],
            worktreeStatus: m[1][1],
            kind: 'unmerged'
          }
        }
        break
      }
      case '?':
        entry = {
          path: record.slice(2),
          origPath: null,
          indexStatus: '.',
          worktreeStatus: '.',
          kind: 'untracked'
        }
        break
      case '!':
        entry = {
          path: record.slice(2),
          origPath: null,
          indexStatus: '.',
          worktreeStatus: '.',
          kind: 'ignored'
        }
        break
    }
    if (entry) status.entries.push(entry)
  }

  for (const entry of status.entries) {
    switch (entry.kind) {
      case 'untracked':
        status.untracked++
        break
      case 'unmerged':
        status.conflicted++
        break
      case 'tracked':
      case 'renamed':
        if (entry.indexStatus !== '.') status.staged++
        if (entry.worktreeStatus !== '.') status.unstaged++
        break
    }
  }
  status.changedCount = status.entries.filter((e) => e.kind !== 'ignored').length

  return status
}
