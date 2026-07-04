import { detectProcess } from "./process-detect.js";

export async function detectClaude(): Promise<{ running: boolean; pids: number[] }> {
  const running = await detectProcess(
    process.platform === "win32" ? ["Claude.exe", "claude.exe"] : ["Claude", "claude"],
  );
  return { running, pids: [] };
}
