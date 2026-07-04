import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function detectProcess(names: string[]): Promise<boolean> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync("tasklist", []).catch(() => ({ stdout: "" }));
    const lower = stdout.toLowerCase();
    return names.some((name) => lower.includes(name.toLowerCase()));
  }
  for (const name of names) {
    const result = await execFileAsync("pgrep", ["-x", name]).catch(() => null);
    if (result) return true;
  }
  return false;
}
