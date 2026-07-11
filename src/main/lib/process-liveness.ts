import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

// live-sessions.ts에서 추출한 PID 생존검증 유틸. recall.ts(getTimeline)도 라이브 세션을
// 판정해야 하는데 live-sessions.ts가 recall.ts를 import하므로(순환) lib로 내렸다.

const execFileAsync = promisify(execFile);

export interface ProcessIdentity {
  id: string;
  pid: number;
  startToken: string;
}

export function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * powershell.exe -Command "<스크립트>" <인자> 는 $args를 채우지 않는다 — 인자가 스크립트 뒤에 그대로
 * 이어붙어 구문 오류를 낸다. 입력은 환경변수(base64 JSON)로 넘긴다.
 */
export const PS_PAYLOAD_ENV = "HARNESS_MANAGER_PS_PAYLOAD";

export function psEnv(payload: unknown): NodeJS.ProcessEnv {
  return { ...process.env, [PS_PAYLOAD_ENV]: encodeJson(payload) };
}

export const PS_DECODE = `$payload=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:${PS_PAYLOAD_ENV}))|ConvertFrom-Json;`;

export function parseWindowsProcessProbe(raw: string): Set<string> {
  const parsed = decodeJson<Array<{ id?: unknown; running?: unknown }> | { id?: unknown; running?: unknown }>(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return new Set(rows.filter((row) => typeof row.id === "string" && row.running === true).map((row) => row.id as string));
}

async function windowsRunningProcessIds(identities: ProcessIdentity[]): Promise<Set<string>> {
  if (!identities.length) return new Set();
  const script = `${PS_DECODE}$out=foreach($item in $payload){$p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$item.pid) -ErrorAction SilentlyContinue;$running=$null -ne $p -and [string]$p.CreationDate -eq [string]$item.startToken;[pscustomobject]@{id=$item.id;running=$running}};ConvertTo-Json -InputObject @($out) -Compress`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 2_000, maxBuffer: 256 * 1024, env: psEnv(identities) },
    );
    return parseWindowsProcessProbe(stdout);
  } catch {
    return new Set();
  }
}

async function unixRunningProcessIds(identities: ProcessIdentity[]): Promise<Set<string>> {
  const running = new Set<string>();
  await Promise.all(
    identities.map(async (identity) => {
      try {
        const raw = await fs.readFile(`/proc/${identity.pid}/stat`, "utf8");
        const fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
        if (fields[19] === identity.startToken) running.add(identity.id);
      } catch {
        // PID가 사라졌거나 /proc 접근이 불가하면 실행 중으로 추정하지 않는다.
      }
    }),
  );
  return running;
}

/** PID가 "기록된 시각에 시작한 바로 그 프로세스"로 살아있는 것만 남긴다(PID 재사용 오탐 방지). */
export async function runningProcessIds(identities: ProcessIdentity[]): Promise<Set<string>> {
  return process.platform === "win32"
    ? windowsRunningProcessIds(identities)
    : unixRunningProcessIds(identities);
}
