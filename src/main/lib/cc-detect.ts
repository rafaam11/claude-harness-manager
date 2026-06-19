import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Claude Code 프로세스 실행 여부 감지 (Windows / macOS / Linux).
 * native 설치는 Windows에서 claude.exe, 그 외 플랫폼에서 claude 바이너리로 실행된다.
 * 이 서버 자신은 node라 오탐 없음. 감지 명령이 없는 환경(pgrep 부재 등)은 catch로 미실행 처리.
 */
export async function detectClaude(): Promise<{ running: boolean; pids: number[] }> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execAsync(
        'tasklist /FI "IMAGENAME eq claude.exe" /FO CSV /NH',
        { windowsHide: true },
      );
      const pids = stdout
        .split("\n")
        .map((line) => line.split('","')[1])
        .filter((p) => p && /^\d+$/.test(p))
        .map(Number);
      return { running: pids.length > 0, pids };
    }
    // macOS/Linux: native 설치는 `claude` 바이너리. -x로 프로세스 이름을 정확히 일치시킨다.
    // (Windows 경로와 동일하게 node로 띄운 경우는 감지 대상에서 제외 — 일관된 한계.)
    const { stdout } = await execAsync("pgrep -x claude");
    const pids = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter((p) => /^\d+$/.test(p))
      .map(Number);
    return { running: pids.length > 0, pids };
  } catch {
    return { running: false, pids: [] };
  }
}
