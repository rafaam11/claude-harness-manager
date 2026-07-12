import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  LiveSession,
  LiveSessionTodos,
  NormalizedSession,
  ProviderFilter,
  SessionActivity,
} from "@shared/provider-types";
import { getProviders, prefixEntityId } from "../providers/registry.js";
import { normalizePathKey } from "../lib/path-normalize.js";
import { PS_DECODE, decodeJson, psEnv, runningProcessIds } from "../lib/process-liveness.js";
import type { BoardData } from "../lib/board.js";
import { readBoardWithProjectRegistry } from "../lib/project-registry.js";
import {
  getProjectRecalls,
  getSessionRecallByTranscriptPath,
  isDirectSessionRecall,
  isPinnedSession,
} from "./recall.js";
import { getSessionTodos } from "./tasks.js";
import { readClaudeLiveSessionRecords, type ClaudeLiveSessionRecord } from "./claude-live-tracking.js";

/** Codex rollout에는 상태 신호가 없다 — 프로세스가 살아있다는 것만 안다. */
const UNKNOWN_ACTIVITY: SessionActivity = { state: "unknown", since: null, tool: null };

const execFileAsync = promisify(execFile);

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
  const script = `${PS_DECODE}$out=foreach($p in $payload){$locked=$false;if(Test-Path -LiteralPath $p){try{$s=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);$s.Dispose()}catch{$locked=$true}};[pscustomobject]@{path=$p;locked=$locked}};ConvertTo-Json -InputObject @($out) -Compress`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 2_000, maxBuffer: 1_024 * 1_024, env: psEnv(paths) },
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

async function liveCodexSessions(detectedAt: string, board: BoardData): Promise<LiveSession[]> {
  const provider = getProviders("codex")[0];
  const sessions = provider ? await provider.listSessions() : [];
  const candidates = sessions.filter(
    (session): session is NormalizedSession & { sourcePath: string } =>
      session.provider === "codex" && session.sessionKind === "main" && Boolean(session.sourcePath),
  );
  const locked = await lockedRollouts(candidates.map((session) => session.sourcePath));
  if (!locked.size) return [];
  return candidates
    .filter((session) => locked.has(path.normalize(session.sourcePath)))
    .map((session) => codexLiveSession(session, detectedAt, board));
}

function codexLiveSession(
  session: NormalizedSession,
  detectedAt: string,
  board: BoardData,
): LiveSession {
  return {
    id: session.id,
    provider: "codex",
    projectId: session.projectId ?? null,
    sessionKind: session.sessionKind,
    title: session.title ?? "(실행 중 Codex 세션)",
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    updatedAt: session.updatedAt,
    detectedAt,
    source: "codex-rollout-lock",
    activity: UNKNOWN_ACTIVITY,
    todos: null,
    lastPrompt: session.lastUserText ?? null,
    lastAssistantSnippet: session.lastAssistantText ?? null,
    pinned: isPinnedSession(board, session.id),
  };
}

async function liveClaudeSessions(detectedAt: string, board: BoardData): Promise<LiveSession[]> {
  const records = (await readClaudeLiveSessionRecords()).filter((record) => !record.endedAt);
  const running = await runningProcessIds(
    records.map((record) => ({ id: record.sessionId, pid: record.processPid, startToken: record.processStartToken })),
  );
  if (!running.size) return [];
  const projects = await getProjectRecalls();
  const sessions = await Promise.all(
    records
      .filter((record) => running.has(record.sessionId))
      .map((record) => claudeLiveSession(record, projects, detectedAt, board)),
  );
  return sessions.filter((session): session is LiveSession => session !== null);
}

/** TodoWrite 항목을 "3/7 · 지금 하는 일" 한 줄로 압축한다. */
function liveTodos(todos: Awaited<ReturnType<typeof getSessionTodos>>): LiveSessionTodos | null {
  if (!todos) return null;
  const active = todos.items.find((item) => item.status === "in_progress");
  return {
    total: todos.total,
    done: todos.done,
    active: active ? active.activeForm ?? active.subject : null,
    items: todos.items,
  };
}

async function claudeLiveSession(
  record: ClaudeLiveSessionRecord,
  projects: Awaited<ReturnType<typeof getProjectRecalls>>,
  detectedAt: string,
  board: BoardData,
): Promise<LiveSession | null> {
  const recall = await getSessionRecallByTranscriptPath(record.transcriptPath);
  if (recall && !isDirectSessionRecall(recall)) return null;
  const cwd = recall?.cwd ?? record.cwd;
  const project = cwd ? projects.find((candidate) => candidate.realPath && normalizePathKey(candidate.realPath) === normalizePathKey(cwd)) : undefined;
  const sessionId = recall?.sessionId ?? record.sessionId;
  const todos = await getSessionTodos(sessionId);
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
    activity: recall?.activity ?? UNKNOWN_ACTIVITY,
    todos: liveTodos(todos),
    lastPrompt: recall?.lastPrompt ?? null,
    lastAssistantSnippet: recall?.lastAssistantSnippet ?? null,
    pinned: isPinnedSession(board, sessionId),
  };
}

export async function getLiveSessions(filter: ProviderFilter = "all"): Promise<LiveSession[]> {
  const detectedAt = new Date().toISOString();
  const board = await readBoardWithProjectRegistry();
  const groups = await Promise.all([
    filter === "all" || filter === "codex" ? liveCodexSessions(detectedAt, board) : Promise.resolve([]),
    filter === "all" || filter === "claude" ? liveClaudeSessions(detectedAt, board) : Promise.resolve([]),
  ]);
  return groups.flat().sort((a, b) => (b.updatedAt ?? b.detectedAt).localeCompare(a.updatedAt ?? a.detectedAt));
}
