import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectProcess } from "../lib/process-detect.js";
import { readCodexMcpServersFromToml } from "../lib/toml-validate.js";
import type { ProviderAdapter } from "./types.js";
import type { SessionKind } from "@shared/provider-types";

export const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
export const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");
export const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
export const CODEX_HISTORY = path.join(CODEX_HOME, "history.jsonl");
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

function isInjectedCodexText(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("# AGENTS.md instructions") ||
    t.startsWith("<INSTRUCTIONS>") ||
    t.startsWith("<environment_context>") ||
    t.startsWith("<permissions instructions>") ||
    t.startsWith("<collaboration_mode>") ||
    t.startsWith("<apps_instructions>") ||
    t.startsWith("<skills_instructions>") ||
    t.startsWith("<user_shell_command>") ||
    t.startsWith("<subagent_notification>") ||
    t.startsWith("========= MEMORY_SUMMARY") ||
    t.startsWith("You are Codex,")
  );
}

function isWorkerCodexText(text: string): boolean {
  const t = text.trimStart();
  return (
    t.startsWith("CODE REVIEW TASK") ||
    t.startsWith("ARCHITECTURE / DEVIL'S-ADVOCATE REVIEW TASK") ||
    t.startsWith("ARCHITECTURE / DEVIL’S-ADVOCATE REVIEW TASK") ||
    t.startsWith("Review Task ") ||
    t.startsWith("Read-only review") ||
    t.startsWith("You are implementing Task ") ||
    t.startsWith("You are reviewing Task ") ||
    t.startsWith("You are re-reviewing") ||
    t.startsWith("You are a final-review") ||
    t.startsWith("You are a final review") ||
    t.startsWith("You are a Senior Code Reviewer") ||
    /^You are .*subagent\b/i.test(t.slice(0, 500)) ||
    /\b(read-only; do not mutate repo|READ-ONLY; DO NOT MUTATE REPO)\b/.test(t.slice(0, 800))
  );
}

function sessionKindFromUserText(text: string): SessionKind {
  if (isInjectedCodexText(text)) return "system";
  if (isWorkerCodexText(text)) return "worker";
  return "main";
}

function preferSessionKind(current: SessionKind, next: SessionKind): SessionKind {
  if (next === "main") return "main";
  if (current === "main") return current;
  if (next === "worker") return "worker";
  if (current === "worker") return current;
  if (next === "system") return "system";
  return current;
}

function userTextFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    const text = content.trim();
    return text && !isInjectedCodexText(text) ? text : null;
  }
  if (!Array.isArray(content)) return null;
  const candidates: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (
      record.type === "input_text" &&
      typeof record.text === "string" &&
      record.text.trim() &&
      !isInjectedCodexText(record.text)
    ) {
      candidates.push(record.text.trim());
    }
  }
  return candidates.at(-1) ?? null;
}

interface CodexSessionSummary {
  id: `codex:${string}`;
  localId: string;
  projectId: `codex:${string}` | undefined;
  sessionKind: SessionKind;
  cwd: string | undefined;
  model: string | undefined;
  title: string | undefined;
  updatedAt: string;
  lastUserText: string | undefined;
  lastAssistantText: string | undefined;
  sourcePath: string;
}

interface CodexHistoryEntry {
  sessionId: string;
  text: string;
  updatedAt: string;
}

function isNoiseHistoryText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("⚠") || isInjectedCodexText(t);
}

async function readCodexHistory(): Promise<Map<string, CodexHistoryEntry>> {
  const raw = await fs.readFile(CODEX_HISTORY, "utf8").catch(() => "");
  const latest = new Map<string, CodexHistoryEntry>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o?.session_id !== "string" || typeof o?.text !== "string") continue;
    const text = o.text.trim();
    if (!text || isNoiseHistoryText(text)) continue;
    const updatedAt = isoFromTimestamp(o.ts) ?? iso(Date.now());
    const prev = latest.get(o.session_id);
    if (!prev || Date.parse(updatedAt) >= Date.parse(prev.updatedAt)) {
      latest.set(o.session_id, { sessionId: o.session_id, text, updatedAt });
    }
  }
  return latest;
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
    const text = userTextFromContent(payload.content);
    if (text && !text.startsWith("<")) {
      acc.lastUserText = text;
      acc.title = text;
      acc.sessionKind = preferSessionKind(acc.sessionKind, sessionKindFromUserText(text));
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
    sessionKind: "unknown",
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

function sessionKindRank(kind: SessionKind): number {
  if (kind === "main") return 3;
  if (kind === "worker") return 2;
  if (kind === "system") return 1;
  return 0;
}

function newerSession(a: CodexSessionSummary, b: CodexSessionSummary): CodexSessionSummary {
  return Date.parse(b.updatedAt) >= Date.parse(a.updatedAt) ? b : a;
}

function betterUserFacingSession(
  a: CodexSessionSummary,
  b: CodexSessionSummary,
): CodexSessionSummary {
  const ar = sessionKindRank(a.sessionKind);
  const br = sessionKindRank(b.sessionKind);
  if (ar !== br) return br > ar ? b : a;
  return newerSession(a, b);
}

function mergeCodexSessionSummary(
  a: CodexSessionSummary,
  b: CodexSessionSummary,
): CodexSessionSummary {
  const latest = newerSession(a, b);
  const userFacing = betterUserFacingSession(a, b);
  return {
    ...latest,
    sessionKind: preferSessionKind(a.sessionKind, b.sessionKind),
    title: userFacing.title ?? latest.title,
    lastUserText: userFacing.lastUserText ?? latest.lastUserText,
    lastAssistantText: latest.lastAssistantText ?? userFacing.lastAssistantText,
    sourcePath: userFacing.sourcePath,
  };
}

async function readCodexSessions(): Promise<CodexSessionSummary[]> {
  const files = await listSessionFiles();
  const rawSessions = (await Promise.all(files.map((file) => readCodexSession(file)))).filter(
    (s): s is CodexSessionSummary => Boolean(s),
  );
  const history = await readCodexHistory();
  const byId = new Map<string, CodexSessionSummary>();
  for (const session of rawSessions) {
    const prev = byId.get(session.id);
    byId.set(session.id, prev ? mergeCodexSessionSummary(prev, session) : session);
  }
  const sessions = [...byId.values()];
  return sessions
    .filter(
      (session) =>
        session.cwd || session.lastUserText || session.lastAssistantText || history.has(session.localId),
    )
    .map((session) => {
      const h = history.get(session.localId);
      if (!h) return session;
      return {
        ...session,
        title: h.text,
        lastUserText: h.text,
        sessionKind: preferSessionKind(session.sessionKind, sessionKindFromUserText(h.text)),
        updatedAt: Date.parse(h.updatedAt) >= Date.parse(session.updatedAt) ? h.updatedAt : session.updatedAt,
      };
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
      sessionKind: session.sessionKind,
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
