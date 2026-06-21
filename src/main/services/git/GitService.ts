// DT_GitManager에서 흡수. git CLI 저수준 래퍼(execGit) + 버전/상태/toplevel 조회.
import { execFile } from 'child_process'
import { promisify } from 'util'
import { MIN_GIT_VERSION, type GitVersionInfo, type RepoStatus } from '@shared/types'
import { parseStatusV2 } from './parsers.js'

const execFileAsync = promisify(execFile)

const MAX_BUFFER = 32 * 1024 * 1024

export interface ExecGitOptions {
  /** extra environment variables, merged over process.env (e.g. GIT_EDITOR=true) */
  env?: NodeJS.ProcessEnv
}

export async function execGit(
  repoPath: string,
  args: string[],
  options: ExecGitOptions = {}
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    maxBuffer: MAX_BUFFER,
    encoding: 'utf8',
    env: options.env ? { ...process.env, ...options.env } : process.env
  })
  return stdout
}

/** Error thrown by a failed git child process, carrying stdout/stderr/exit code. */
interface GitExecError {
  code?: number | string
  stdout?: string
  stderr?: string
  message?: string
}

/** Extracts git's own error text from a rejected exec, preferring stderr. */
export function gitErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as GitExecError
    const stderr = (e.stderr ?? '').trim()
    if (stderr) return stderr
    if (e.message) return e.message
  }
  return String(error)
}

/**
 * Runs git like {@link execGit} but tolerates the given non-zero exit codes,
 * returning their stdout instead of throwing. Used for `git diff --no-index`,
 * which exits 1 when the inputs differ.
 */
export async function execGitAllowingCodes(
  repoPath: string,
  args: string[],
  allowedCodes: number[]
): Promise<string> {
  try {
    return await execGit(repoPath, args)
  } catch (error) {
    const e = error as GitExecError
    if (typeof e.code === 'number' && allowedCodes.includes(e.code) && typeof e.stdout === 'string') {
      return e.stdout
    }
    throw error
  }
}

/** Returns the repository toplevel for a directory, or null if it is not inside a work tree. */
export async function resolveRepoRoot(dirPath: string): Promise<string | null> {
  try {
    const stdout = await execGit(dirPath, ['rev-parse', '--show-toplevel'])
    const top = stdout.trim()
    return top ? top : null
  } catch {
    return null
  }
}

export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  const stdout = await execGit(repoPath, ['status', '--porcelain=v2', '--branch', '-z'])
  return parseStatusV2(stdout)
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

export async function getGitVersion(): Promise<GitVersionInfo | null> {
  try {
    const { stdout } = await execFileAsync('git', ['--version'])
    const raw = stdout.trim()
    const match = raw.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
    if (!match) {
      return { raw, version: '', supported: false }
    }
    const version = `${match[1]}.${match[2]}.${match[3] ?? '0'}`
    return { raw, version, supported: compareVersions(version, MIN_GIT_VERSION) >= 0 }
  } catch {
    // git is not installed or not in PATH
    return null
  }
}
