import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProcess } from "../lib/process-detect.js";
import { readCodexMcpServersFromToml } from "../lib/toml-validate.js";
import type { ProviderAdapter } from "./types.js";

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");
export const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const CODEX_SESSION_TAIL_BYTES = 512 * 1024;

async function statOrNull(p: string) {
  return fs.stat(p).catch(() => null);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function isoFromTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  return null;
}

function localProjectIdFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const parsed = path.win32.parse(cwd);
  if (parsed.root && /^[A-Za-z]:\\?$/.test(parsed.root)) {
    const drive = parsed.root[0].toUpperCase();
    const rest = cwd
      .slice(parsed.root.length)
      .replace(/[\\/]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return rest ? `${drive}--${rest}` : `${drive}--`;
  }
  return normalized.replace(/^\//, "-").replace(/\//g, "-") || "unknown";
}

function titleFromCwd(cwd: string): string {
  const base = path.basename(cwd);
  return base || cwd;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string" && content.trim()) return content.trim();
  if (!Array.isArray(content)) return null;
  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (
      (record.type === "input_text" || record.type === "output_text" || record.type === "text") &&
      typeof record.text === "string" &&
      record.text.trim()
    ) {
      chunks.push(record.text.trim());
    }
  }
  return chunks.length ? chunks.join("\n") : null;
}

interface CodexSessionSummary {
  id: `codex:${string}`;
  localId: string;
  projectId: `codex:${string}` | undefined;
  cwd: string | undefined;
  model: string | undefined;
  title: string | undefined;
  updatedAt: string;
  lastUserText: string | undefined;
  lastAssistantText: string | undefined;
  sourcePath: string;
}

async function readHead(filePath: string, bytes = 64 * 1024): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const len = Math.min(stat.size, bytes);
    const buffer = Buffer.alloc(len);
    await handle.read(buffer, 0, len, 0);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readTail(filePath: string, size: number, bytes = CODEX_SESSION_TAIL_BYTES): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const len = Math.min(size, bytes);
    const buffer = Buffer.alloc(len);
    await handle.read(buffer, 0, len, Math.max(0, size - len));
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function listSessionFiles(): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  await walk(CODEX_SESSIONS_DIR);
  return files;
}

function applyCodexLine(line: string, acc: CodexSessionSummary) {
  if (!line.trim()) return;
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  const ts = isoFromTimestamp(o?.timestamp ?? o?.payload?.timestamp ?? o?.payload?.created_at);
  if (ts && Date.parse(ts) >= Date.parse(acc.updatedAt)) acc.updatedAt = ts;

  if (o?.type === "session_meta") {
    const sid = o.payload?.session_id ?? o.payload?.id;
    if (typeof sid === "string" && sid.trim()) {
      acc.localId = sid;
      acc.id = `codex:${sid}`;
    }
    if (typeof o.payload?.cwd === "string" && o.payload.cwd.trim()) {
      acc.cwd = o.payload.cwd;
      acc.projectId = `codex:${localProjectIdFromCwd(o.payload.cwd)}`;
    }
    if (typeof o.payload?.model === "string") acc.model = o.payload.model;
    return;
  }

  if (o?.type === "turn_context") {
    if (typeof o.payload?.cwd === "string" && o.payload.cwd.trim()) {
      acc.cwd = o.payload.cwd;
      acc.projectId = `codex:${localProjectIdFromCwd(o.payload.cwd)}`;
    }
    if (typeof o.payload?.model === "string") acc.model = o.payload.model;
    return;
  }

  if (o?.type !== "response_item") return;
  const payload = o.payload;
  if (payload?.type !== "message") return;
  if (payload.role === "user") {
    const text = textFromContent(payload.content);
    if (text && !text.startsWith("<")) {
      acc.lastUserText = text;
      acc.title = text;
    }
  } else if (payload.role === "assistant") {
    const text = textFromContent(payload.content);
    if (text) acc.lastAssistantText = text;
  }
}

async function readCodexSession(filePath: string): Promise<CodexSessionSummary | null> {
  const stat = await statOrNull(filePath);
  if (!stat) return null;
  const localId = path.basename(filePath, ".jsonl").replace(/^rollout-[^-]+-[^-]+-[^-]+-/, "");
  const acc: CodexSessionSummary = {
    id: `codex:${localId}`,
    localId,
    projectId: undefined,
    cwd: undefined,
    model: undefined,
    title: undefined,
    updatedAt: iso(stat.mtimeMs),
    lastUserText: undefined,
    lastAssistantText: undefined,
    sourcePath: filePath,
  };

  for (const chunk of [await readHead(filePath), await readTail(filePath, stat.size)]) {
    const lines = chunk.split(/\r?\n/);
    for (const line of lines) applyCodexLine(line, acc);
  }
  return acc;
}

async function readCodexSessions(): Promise<CodexSessionSummary[]> {
  const files = await listSessionFiles();
  const sessions = (await Promise.all(files.map((file) => readCodexSession(file)))).filter(
    (s): s is CodexSessionSummary => Boolean(s),
  );
  return sessions.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

async function codexMemoryFiles(): Promise<string[]> {
  const memories = path.join(CODEX_HOME, "memories");
  return [path.join(memories, "memory_summary.md"), path.join(memories, "MEMORY.md")];
}

async function listProfileConfigs(): Promise<string[]> {
  const entries = await fs.readdir(CODEX_HOME).catch(() => [] as string[]);
  return entries
    .filter((name) => name.endsWith(".config.toml") && name !== "config.toml")
    .map((name) => path.join(CODEX_HOME, name));
}

export const codexProvider: ProviderAdapter = {
  id: "codex",
  label: "Codex",
  roots: { home: CODEX_HOME, configFiles: [CODEX_CONFIG] },
  async listConfigFiles() {
    const profiles = await listProfileConfigs();
    return [
      {
        id: "codex-config",
        provider: "codex",
        label: "config.toml",
        path: CODEX_CONFIG,
        format: "toml",
        scope: "user",
        writable: true,
      },
      ...profiles.map((p) => ({
        id: `codex-profile:${path.basename(p)}`,
        provider: "codex" as const,
        label: path.basename(p),
        path: p,
        format: "toml" as const,
        scope: "user" as const,
        writable: false,
      })),
    ];
  },
  async readMcpServers() {
    const raw = await fs.readFile(CODEX_CONFIG, "utf8").catch(() => "");
    return raw ? readCodexMcpServersFromToml(raw) : [];
  },
  async listCatalog() {
    const items = [];
    const globalAgents = path.join(CODEX_HOME, "AGENTS.md");
    const globalOverride = path.join(CODEX_HOME, "AGENTS.override.md");
    for (const p of [globalAgents, globalOverride]) {
      const stat = await fs.stat(p).catch(() => null);
      if (!stat) continue;
      items.push({
        name: path.basename(p),
        kind: "command" as const,
        description: "Codex instruction file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    const memories = path.join(CODEX_HOME, "memories");
    for (const name of ["memory_summary.md", "MEMORY.md"]) {
      const p = path.join(memories, name);
      const stat = await fs.stat(p).catch(() => null);
      if (!stat) continue;
      items.push({
        name,
        kind: "skill" as const,
        description: "Codex memory file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    return items;
  },
  async listProjects() {
    const byProject = new Map<
      string,
      { localId: string; title: string; realPath: string | null; latestActivityAt: string | null }
    >();
    for (const session of await readCodexSessions()) {
      const localId = session.cwd ? localProjectIdFromCwd(session.cwd) : "unknown";
      const id = `codex:${localId}`;
      const prev = byProject.get(id);
      if (!prev || Date.parse(session.updatedAt) > Date.parse(prev.latestActivityAt ?? "")) {
        byProject.set(id, {
          localId,
          title: session.cwd ? titleFromCwd(session.cwd) : "Codex Session",
          realPath: session.cwd ?? null,
          latestActivityAt: session.updatedAt,
        });
      }
    }
    return [...byProject.entries()]
      .map(([id, project]) => ({
        id: id as `codex:${string}`,
        provider: "codex" as const,
        ...project,
      }))
      .sort((a, b) => Date.parse(b.latestActivityAt ?? "") - Date.parse(a.latestActivityAt ?? ""));
  },
  async listSessions() {
    return (await readCodexSessions()).map((session) => ({
      id: session.id,
      provider: "codex" as const,
      projectId: session.projectId,
      title: session.title ?? session.lastUserText ?? path.basename(session.sourcePath),
      cwd: session.cwd,
      model: session.model,
      updatedAt: session.updatedAt,
      lastUserText: session.lastUserText,
      lastAssistantText: session.lastAssistantText,
      sourcePath: session.sourcePath,
    }));
  },
  async listPlans() {
    return [];
  },
  async detectRunning() {
    return detectProcess(
      process.platform === "win32" ? ["Codex.exe", "codex.exe"] : ["Codex", "codex"],
    );
  },
};
