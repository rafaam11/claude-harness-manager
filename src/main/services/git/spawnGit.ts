// DT_GitManager에서 흡수. git을 spawn으로 실행해 stdin 전달(commit -F -)이 가능하게 한다.
// 1차 흡수에서는 진행 스트리밍(onLine)/취소(signal)를 UI에서 쓰지 않지만,
// CommitService가 stdin 경로를 쓰므로 파일 자체는 유지한다.
import { spawn } from "child_process";

export interface SpawnGitOptions {
  /** written to the child's stdin, then stdin is closed (e.g. commit message) */
  stdin?: string;
  /** aborting kills the child process */
  signal?: AbortSignal;
  /** called for each stdout/stderr line (git --progress uses \r to update a line) */
  onLine?: (line: string) => void;
}

export interface SpawnGitResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** true when the process was killed via the abort signal */
  canceled: boolean;
}

/** Splits a stream into lines on \n, \r, or \r\n so git --progress updates are surfaced. */
function makeLineEmitter(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split(/\r\n|\r|\n/);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part) onLine(part);
    }
  };
}

/**
 * Runs git via spawn so long-running commands can stream progress and be cancelled.
 * Resolves with the exit code and captured output instead of throwing on non-zero exit;
 * rejects only when the process fails to start (e.g. git not found).
 * Forces non-interactive auth (GIT_TERMINAL_PROMPT=0) so missing credentials fail fast.
 */
export function spawnGit(
  repoPath: string,
  args: string[],
  options: SpawnGitOptions = {},
): Promise<SpawnGitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repoPath,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });

    let stdout = "";
    let stderr = "";
    let canceled = false;

    const onAbort = (): void => {
      canceled = true;
      child.kill();
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const emitOut = options.onLine ? makeLineEmitter(options.onLine) : null;
    const emitErr = options.onLine ? makeLineEmitter(options.onLine) : null;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      emitOut?.(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      emitErr?.(chunk);
    });

    child.on("error", (error) => {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, canceled });
    });

    if (options.stdin !== undefined) {
      // git may close stdin before the write completes (e.g. it aborts early);
      // swallow the resulting EPIPE so it doesn't crash the main process.
      child.stdin.on("error", () => {});
      child.stdin.write(options.stdin, "utf8");
      child.stdin.end();
    }
  });
}

/** Best-effort error text from a finished git process, preferring stderr. */
export function spawnErrorMessage(result: SpawnGitResult): string {
  const text = result.stderr.trim() || result.stdout.trim();
  return text || `git이 코드 ${result.code}로 종료되었습니다`;
}
