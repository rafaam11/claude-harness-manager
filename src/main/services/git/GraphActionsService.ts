// DT_GitManager에서 흡수. 그래프 우클릭 액션(checkout/merge/rebase/cherry-pick/revert/reset/tag
// + abort/continue/skip)을 git argv로 매핑해 실행. --continue류는 GIT_EDITOR=true로 에디터 차단.
import type { GraphActionRequest, GraphActionResult } from '@shared/types'
import { execGit, gitErrorMessage, type ExecGitOptions } from './GitService.js'

// Suppress any editor a sequencer might open so --continue never blocks.
const NO_EDITOR: ExecGitOptions = { env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' } }

interface ActionPlan {
  args: string[]
  options?: ExecGitOptions
}

/** Maps a graph action to its exact git argv (and env for editor-suppressed continues). */
function planAction(req: GraphActionRequest): ActionPlan {
  const oid = req.oid ?? ''
  const ref = req.ref ?? ''
  const name = req.name ?? ''
  switch (req.kind) {
    case 'checkout':
      return { args: ['checkout', ref || oid] }
    case 'branch-create':
      return { args: ['branch', name, oid || 'HEAD'] }
    case 'branch-delete':
      return { args: ['branch', req.force ? '-D' : '-d', ref] }
    case 'merge':
      return { args: ['merge', '--no-edit', ref] }
    case 'rebase':
      return { args: ['rebase', ref] }
    case 'cherry-pick':
      return { args: ['cherry-pick', oid] }
    case 'revert':
      return { args: ['revert', '--no-edit', oid] }
    case 'reset-soft':
      return { args: ['reset', '--soft', oid] }
    case 'reset-mixed':
      return { args: ['reset', '--mixed', oid] }
    case 'reset-hard':
      return { args: ['reset', '--hard', oid] }
    case 'tag-create':
      return { args: ['tag', name, oid || 'HEAD'] }
    case 'tag-delete':
      return { args: ['tag', '-d', ref] }
    case 'merge-continue':
      return { args: ['merge', '--continue'], options: NO_EDITOR }
    case 'merge-abort':
      return { args: ['merge', '--abort'] }
    case 'rebase-continue':
      return { args: ['rebase', '--continue'], options: NO_EDITOR }
    case 'rebase-skip':
      return { args: ['rebase', '--skip'] }
    case 'rebase-abort':
      return { args: ['rebase', '--abort'] }
    case 'cherry-pick-continue':
      return { args: ['cherry-pick', '--continue'], options: NO_EDITOR }
    case 'cherry-pick-skip':
      return { args: ['cherry-pick', '--skip'] }
    case 'cherry-pick-abort':
      return { args: ['cherry-pick', '--abort'] }
    case 'revert-continue':
      return { args: ['revert', '--continue'], options: NO_EDITOR }
    case 'revert-abort':
      return { args: ['revert', '--abort'] }
    case 'checkout-track':
      // ref is a remote-tracking name like 'origin/feat'; creates a local branch tracking it
      return { args: ['checkout', '--track', ref] }
    case 'branch-create-checkout':
      return { args: ['checkout', '-b', name] }
    default: {
      const _exhaustive: never = req.kind
      throw new Error(`알 수 없는 액션: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Rejects refs/names that begin with '-' so git cannot parse them as options
 * (e.g. a branch literally named "-D" passed to `checkout`/`branch`). oid values
 * are app-generated commit hashes and are never user-controlled.
 */
function unsafeRefArg(req: GraphActionRequest): string | null {
  for (const value of [req.ref, req.name]) {
    if (value && value.startsWith('-')) return value
  }
  return null
}

/** Runs a graph context-menu action via the local git CLI. */
export async function runGraphAction(
  repoPath: string,
  req: GraphActionRequest
): Promise<GraphActionResult> {
  const unsafe = unsafeRefArg(req)
  if (unsafe) return { ok: false, message: `안전하지 않은 참조 이름입니다: ${unsafe}` }
  try {
    const plan = planAction(req)
    await execGit(repoPath, plan.args, plan.options)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
