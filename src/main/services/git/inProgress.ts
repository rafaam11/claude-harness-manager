// DT_GitManager에서 흡수. .git 상태 파일로 merge/rebase/cherry-pick/revert 진행 상태 감지.
import { stat, readFile } from 'fs/promises'
import { join } from 'path'
import type { InProgressResult, InProgressState } from '@shared/types'
import { execGit, gitErrorMessage } from './GitService.js'

export interface InProgressProbe {
  rebaseMergeExists: boolean
  rebaseApplyExists: boolean
  mergeHeadExists: boolean
  cherryPickHeadExists: boolean
  revertHeadExists: boolean
  rebaseMergeMsgnum?: number | null
  rebaseMergeEnd?: number | null
  rebaseMergeHeadName?: string | null
  rebaseMergeOnto?: string | null
  rebaseApplyNext?: number | null
  rebaseApplyLast?: number | null
}

function stripRef(name: string | null | undefined): string | null {
  if (!name) return null
  return name.replace(/^refs\/heads\//, '')
}

/**
 * Decides the in-progress operation from which .git state files exist and their
 * contents. Pure so it is unit-testable; precedence is rebase, then merge, then
 * cherry-pick, then revert (git never has two at once, but check in this order).
 */
export function deriveInProgress(p: InProgressProbe): InProgressState {
  if (p.rebaseMergeExists) {
    return {
      kind: 'rebase',
      rebaseStyle: 'merge',
      current: p.rebaseMergeMsgnum ?? null,
      total: p.rebaseMergeEnd ?? null,
      ontoRef: stripRef(p.rebaseMergeHeadName) ?? p.rebaseMergeOnto ?? null
    }
  }
  if (p.rebaseApplyExists) {
    return {
      kind: 'rebase',
      rebaseStyle: 'apply',
      current: p.rebaseApplyNext ?? null,
      total: p.rebaseApplyLast ?? null,
      ontoRef: null
    }
  }
  if (p.mergeHeadExists) return { kind: 'merge' }
  if (p.cherryPickHeadExists) return { kind: 'cherry-pick' }
  if (p.revertHeadExists) return { kind: 'revert' }
  return { kind: null }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readNum(path: string): Promise<number | null> {
  try {
    const n = parseInt((await readFile(path, 'utf8')).trim(), 10)
    return Number.isNaN(n) ? null : n
  } catch {
    return null
  }
}

async function readStr(path: string): Promise<string | null> {
  try {
    return (await readFile(path, 'utf8')).trim() || null
  } catch {
    return null
  }
}

/**
 * Detects a merge/rebase/cherry-pick/revert in progress by inspecting the git dir.
 * Uses the worktree-correct absolute git dir (handles linked worktrees/submodules)
 * rather than assuming a literal .git directory.
 */
export async function getInProgress(repoPath: string): Promise<InProgressResult> {
  try {
    const gitDir = (await execGit(repoPath, ['rev-parse', '--absolute-git-dir'])).trim()
    const rm = join(gitDir, 'rebase-merge')
    const ra = join(gitDir, 'rebase-apply')
    const probe: InProgressProbe = {
      rebaseMergeExists: await exists(rm),
      rebaseApplyExists: await exists(ra),
      mergeHeadExists: await exists(join(gitDir, 'MERGE_HEAD')),
      cherryPickHeadExists: await exists(join(gitDir, 'CHERRY_PICK_HEAD')),
      revertHeadExists: await exists(join(gitDir, 'REVERT_HEAD')),
      rebaseMergeMsgnum: await readNum(join(rm, 'msgnum')),
      rebaseMergeEnd: await readNum(join(rm, 'end')),
      rebaseMergeHeadName: await readStr(join(rm, 'head-name')),
      rebaseMergeOnto: await readStr(join(rm, 'onto')),
      rebaseApplyNext: await readNum(join(ra, 'next')),
      rebaseApplyLast: await readNum(join(ra, 'last'))
    }
    return { ok: true, state: deriveInProgress(probe) }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
