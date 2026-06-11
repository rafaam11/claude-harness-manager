import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Claude Code 프로세스 실행 여부 감지 (Windows).
 * native 설치는 claude.exe로 실행된다. 이 서버 자신은 node라 오탐 없음.
 */
export async function detectClaude(): Promise<{ running: boolean; pids: number[] }> {
  try {
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
  } catch {
    return { running: false, pids: [] };
  }
}
