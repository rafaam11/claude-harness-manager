// DT_GitManager에서 흡수. 커밋 메시지를 stdin(`git commit -F -`)으로 넘겨 안전하게 커밋.
import type { CommitResult } from '@shared/types'
import { gitErrorMessage } from './GitService.js'
import { spawnErrorMessage, spawnGit } from './spawnGit.js'

/**
 * Creates a commit with the given message, passed via stdin (`git commit -F -`)
 * so special characters, newlines, and leading dashes are safe. Empty messages
 * are rejected here; git surfaces "nothing to commit" and other errors verbatim.
 */
export async function commit(repoPath: string, message: string): Promise<CommitResult> {
  if (message.trim() === '') {
    return { ok: false, message: '커밋 메시지를 입력하세요' }
  }
  try {
    const result = await spawnGit(repoPath, ['commit', '-F', '-'], { stdin: message })
    if (result.code === 0) return { ok: true }
    return { ok: false, message: spawnErrorMessage(result) }
  } catch (error) {
    return { ok: false, message: gitErrorMessage(error) }
  }
}
