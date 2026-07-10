import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { CODEX_HOME } from "../config.js";
import { guardPath } from "../lib/path-guard.js";

const execFileAsync = promisify(execFile);
const STATE_DB = path.join(CODEX_HOME, "state_5.sqlite");
const ACTIVE_THREADS_SQL = `
  SELECT id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, model, thread_source
  FROM threads
  WHERE archived = 0
`;

export interface CodexStateThread {
  id: string;
  rolloutPath: string;
  createdAt: number;
  updatedAt: number;
  source: string;
  modelProvider: string;
  cwd: string;
  title: string;
  model: string | undefined;
  threadSource: string | undefined;
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseCodexStateThreads(raw: string): CodexStateThread[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const threads: CodexStateThread[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const createdAt = timestamp(row.created_at);
    const updatedAt = timestamp(row.updated_at);
    if (
      typeof row.id !== "string" ||
      typeof row.rollout_path !== "string" ||
      typeof row.source !== "string" ||
      typeof row.model_provider !== "string" ||
      typeof row.cwd !== "string" ||
      typeof row.title !== "string" ||
      createdAt === null ||
      updatedAt === null
    ) {
      continue;
    }
    threads.push({
      id: row.id,
      rolloutPath: row.rollout_path,
      createdAt,
      updatedAt,
      source: row.source,
      modelProvider: row.model_provider,
      cwd: row.cwd,
      title: row.title,
      model: typeof row.model === "string" && row.model ? row.model : undefined,
      threadSource: typeof row.thread_source === "string" && row.thread_source ? row.thread_source : undefined,
    });
  }
  return threads;
}

export async function readCodexStateThreads(): Promise<CodexStateThread[]> {
  const dbPath = guardPath(STATE_DB);
  const exists = await fs.stat(dbPath).then(() => true).catch(() => false);
  if (!exists) return [];
  try {
    const command = process.platform === "win32" ? "sqlite3.exe" : "sqlite3";
    const { stdout } = await execFileAsync(command, ["-readonly", "-json", dbPath, ACTIVE_THREADS_SQL], {
      windowsHide: true,
      timeout: 2_000,
      maxBuffer: 1_024 * 1_024,
    });
    return parseCodexStateThreads(stdout);
  } catch {
    return [];
  }
}
