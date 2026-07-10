import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { LiveSession, NormalizedSession, ProviderFilter } from "@shared/provider-types";
import { getProviders, prefixEntityId } from "../providers/registry.js";
import { readCodexStateThreads, type CodexStateThread } from "../providers/codex-state.js";
import { normalizePathKey } from "../lib/path-normalize.js";
import {
  getProjectRecalls,
  getSessionRecallByTranscriptPath,
  isDirectSessionRecall,
} from "./recall.js";
import { readClaudeLiveSessionRecords, type ClaudeLiveSessionRecord } from "./claude-live-tracking.js";

const execFileAsync = promisify(execFile);

interface ProcessIdentity {
  id: string;
  pid: number;
  startToken: string;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decodeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isoFromEpoch(value: number): string {
  return new Date(value < 1_000_000_000_000 ? value * 1000 : value).toISOString();
}

/** Windows FileShare.Read로 열리지 않는 rollout만 Codex CLI가 점유한 실행 중 파일로 본다. */
export function parseWindowsLockProbe(raw: string): Set<string> {
  const parsed = decodeJson<Array<{ path?: unknown; locked?: unknown }> | { path?: unknown; locked?: unknown }>(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return new Set(
    rows
      .filter((row) => typeof row.path === "string" && row.locked === true)
      .map((row) => path.normalize(row.path as string)),
  );
}

async function windowsLockedPaths(paths: string[]): Promise<Set<string>> {
  if (!paths.length) return new Set();
  const script = "$paths=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))|ConvertFrom-Json;$out=foreach($p in $paths){$locked=$false;if(Test-Path -LiteralPath $p){try{$s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$s.Dispose()}catch{$locked=$true}};[pscustomobject]@{path=$p;locked=$locked}};$out|ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script, encodeJson(paths)],
      { windowsHide: true, timeout: 2_000, maxBuffer: 1_024 * 1_024 },
    );
    return parseWindowsLockProbe(stdout);
  } catch {
    return new Set();
  }
}

async function unixLockedPaths(paths: string[]): Promise<Set<string>> {
  const locked = new Set<string>();
  const remaining = [...paths];
  const workerCount = Math.min(8, remaining.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (remaining.length > 0) {
        const filePath = remaining.pop();
        if (!filePath) return;

        try {
          const { stdout } = await execFileAsync("lsof", ["-F", "p", "--", filePath], {
            timeout: 1_500,
            windowsHide: true,
          });
          if (stdout.trim().startsWith("p")) locked.add(filePath);
        } catch {
          // lsof exits 1 when no process has the rollout open. Missing lsof is also a no-result.
        }
      }
    }),
  );

  return locked;
}

async function lockedRollouts(paths: string[]): Promise<Set<string>> {
  return process.platform === "win32" ? windowsLockedPaths(paths) : unixLockedPaths(paths);
}

async function liveCodexSessions(detectedAt: string): Promise<LiveSession[]> {
  const threads = (await readCodexStateThreads()).filter(
    (thread) => thread.source === "cli" && thread.threadSource === "user",
  );
  const locked = await lockedRollouts(threads.map((thread) => thread.rolloutPath));
  if (!locked.size) return [];
  const provider = getProviders("codex")[0];
  const sessions = provider ? await provider.listSessions() : [];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return threads
    .filter((thread) => locked.has(path.normalize(thread.rolloutPath)))
    .map((thread) => codexLiveSession(thread, byId.get(`codex:${thread.id}`), detectedAt));
}

function codexLiveSession(
  thread: CodexStateThread,
  session: NormalizedSession | undefined,
  detectedAt: string,
): LiveSession {
  return {
    id: (`codex:${thread.id}`) as LiveSession["id"],
    provider: "codex",
    projectId: session?.projectId ?? null,
    sessionKind: session?.sessionKind ?? "main",
    title: session?.title ?? thread.title ?? "(실행 중 Codex 세션)",
    cwd: session?.cwd ?? thread.cwd,
    model: session?.model ?? thread.model ?? null,
    updatedAt: session?.updatedAt ?? isoFromEpoch(thread.updatedAt),
    detectedAt,
    source: "codex-rollout-lock",
  };
}

export function parseWindowsProcessProbe(raw: string): Set<string> {
  const parsed = decodeJson<Array<{ id?: unknown; running?: unknown }> | { id?: unknown; running?: unknown }>(raw);
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  return new Set(rows.filter((row) => typeof row.id === "string" && row.running === true).map((row) => row.id as string));
}

async function windowsRunningProcessIds(identities: ProcessIdentity[]): Promise<Set<string>> {
  if (!identities.length) return new Set();
  const script = "$items=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]))|ConvertFrom-Json;$out=foreach($item in $items){$p=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$item.pid) -ErrorAction SilentlyContinue;$running=$null -ne $p -and [string]$p.CreationDate -eq [string]$item.startToken;[pscustomobject]@{id=$item.id;running=$running}};$out|ConvertTo-Json -Compress";
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script, encodeJson(identities)],
      { windowsHide: true, timeout: 2_000, maxBuffer: 256 * 1024 },
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

async function runningProcessIds(identities: ProcessIdentity[]): Promise<Set<string>> {
  return process.platform === "win32"
    ? windowsRunningProcessIds(identities)
    : unixRunningProcessIds(identities);
}

async function liveClaudeSessions(detectedAt: string): Promise<LiveSession[]> {
  const records = (await readClaudeLiveSessionRecords()).filter((record) => !record.endedAt);
  const running = await runningProcessIds(
    records.map((record) => ({ id: record.sessionId, pid: record.processPid, startToken: record.processStartToken })),
  );
  if (!running.size) return [];
  const projects = await getProjectRecalls();
  const sessions = await Promise.all(
    records.filter((record) => running.has(record.sessionId)).map((record) => claudeLiveSession(record, projects, detectedAt)),
  );
  return sessions.filter((session): session is LiveSession => session !== null);
}

async function claudeLiveSession(
  record: ClaudeLiveSessionRecord,
  projects: Awaited<ReturnType<typeof getProjectRecalls>>,
  detectedAt: string,
): Promise<LiveSession | null> {
  const recall = await getSessionRecallByTranscriptPath(record.transcriptPath);
  if (recall && !isDirectSessionRecall(recall)) return null;
  const cwd = recall?.cwd ?? record.cwd;
  const project = cwd ? projects.find((candidate) => candidate.realPath && normalizePathKey(candidate.realPath) === normalizePathKey(cwd)) : undefined;
  const sessionId = recall?.sessionId ?? record.sessionId;
  return {
    id: prefixEntityId("claude", sessionId),
    provider: "claude",
    projectId: project ? prefixEntityId("claude", project.id) : null,
    sessionKind: recall?.sessionKind ?? "main",
    title: recall?.aiTitle ?? recall?.lastPrompt ?? "(실행 중 Claude 세션)",
    cwd,
    model: recall?.lastModel ?? record.model,
    updatedAt: recall ? new Date(recall.transcriptMtime).toISOString() : null,
    detectedAt,
    source: "claude-hook",
  };
}

export async function getLiveSessions(filter: ProviderFilter = "all"): Promise<LiveSession[]> {
  const detectedAt = new Date().toISOString();
  const groups = await Promise.all([
    filter === "all" || filter === "codex" ? liveCodexSessions(detectedAt) : Promise.resolve([]),
    filter === "all" || filter === "claude" ? liveClaudeSessions(detectedAt) : Promise.resolve([]),
  ]);
  return groups.flat().sort((a, b) => (b.updatedAt ?? b.detectedAt).localeCompare(a.updatedAt ?? a.detectedAt));
}
