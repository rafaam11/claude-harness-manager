import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { CODEX_HOME, WORKSPACE_CACHE_TTL_MS } from "../config.js";
import { detectProcess } from "../lib/process-detect.js";
import { parseTimeMs } from "../lib/time.js";
import { readCodexMcpServersFromToml } from "../lib/toml-validate.js";
import { readCodexStateThreads, type CodexStateThread } from "./codex-state.js";
import type { ProviderAdapter } from "./types.js";
import type { SessionKind } from "@shared/provider-types";

export { CODEX_HOME };
export const CODEX_CONFIG = path.join(CODEX_HOME, "config.toml");
export const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
export const CODEX_HISTORY = path.join(CODEX_HOME, "history.jsonl");
export const CODEX_SESSION_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
const CODEX_SESSION_TAIL_BYTES = 512 * 1024;
const CODEX_SESSION_HEAD_BYTES = 64 * 1024;

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
  if (parsed.root && /^[A-Za-z]:[\\/]?$/.test(parsed.root)) {
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
    t.startsWith("⚠") ||
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
  originator: string | undefined;
  source: string | undefined;
  threadSource: string | undefined;
  cwd: string | undefined;
  model: string | undefined;
  title: string | undefined;
  firstUserText: string | undefined;
  updatedAt: string;
  startedAt: string | undefined;
  turnCount: number | undefined;
  turnIds: Set<string>;
  completeScan: boolean;
  lastUserText: string | undefined;
  lastAssistantText: string | undefined;
  lastFinalAnswerText: string | undefined;
  lastAssistantFallbackText: string | undefined;
  sourcePath: string;
}

interface CodexHistoryEntry {
  sessionId: string;
  firstText: string;
  lastText: string;
  firstAt: string | undefined;
  lastAt: string | undefined;
  turnCount: number;
}

interface CodexSessionIndexEntry {
  threadName: string;
  updatedAt: string | undefined;
}

function isNoiseHistoryText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("⚠") || isInjectedCodexText(t);
}

async function readCodexHistory(): Promise<Map<string, CodexHistoryEntry>> {
  const raw = await fs.readFile(CODEX_HISTORY, "utf8").catch(() => "");
  const entries = new Map<string, CodexHistoryEntry>();
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
    const at = isoFromTimestamp(o.ts) ?? undefined;
    const prev = entries.get(o.session_id);
    entries.set(o.session_id, {
      sessionId: o.session_id,
      firstText: prev?.firstText ?? text,
      lastText: text,
      firstAt: prev?.firstAt ?? at,
      lastAt: at ?? prev?.lastAt,
      turnCount: (prev?.turnCount ?? 0) + 1,
    });
  }
  return entries;
}

async function readCodexSessionIndex(): Promise<Map<string, CodexSessionIndexEntry>> {
  const raw = await fs.readFile(CODEX_SESSION_INDEX, "utf8").catch(() => "");
  const entries = new Map<string, CodexSessionIndexEntry>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof o?.id !== "string" || typeof o?.thread_name !== "string" || !o.thread_name.trim()) continue;
    entries.set(o.id, {
      threadName: o.thread_name.trim(),
      updatedAt: isoFromTimestamp(o.updated_at) ?? undefined,
    });
  }
  return entries;
}

async function readRange(filePath: string, start: number, bytes: number): Promise<string> {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const len = Math.max(0, Math.min(stat.size - start, bytes));
    const buffer = Buffer.alloc(len);
    await handle.read(buffer, 0, len, start);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

async function readSessionChunks(filePath: string, size: number): Promise<{ chunks: string[]; complete: boolean }> {
  if (size <= CODEX_SESSION_TAIL_BYTES) {
    return { chunks: [await fs.readFile(filePath, "utf8")], complete: true };
  }
  const headLength = Math.min(size, CODEX_SESSION_HEAD_BYTES);
  const tailStart = Math.max(headLength, size - CODEX_SESSION_TAIL_BYTES);
  const [head, tail] = await Promise.all([
    readRange(filePath, 0, headLength),
    readRange(filePath, tailStart, size - tailStart),
  ]);
  return { chunks: [head, tail], complete: false };
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

function applyUserText(text: string, acc: CodexSessionSummary) {
  const trimmed = text.trim();
  if (!trimmed || isInjectedCodexText(trimmed)) return;
  acc.firstUserText ??= trimmed;
  acc.title ??= trimmed;
  acc.lastUserText = trimmed;
  acc.sessionKind = preferSessionKind(acc.sessionKind, sessionKindFromUserText(trimmed));
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
  if (ts && parseTimeMs(ts) >= parseTimeMs(acc.updatedAt)) acc.updatedAt = ts;

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
    if (typeof o.payload?.originator === "string") acc.originator = o.payload.originator;
    if (typeof o.payload?.source === "string") acc.source = o.payload.source;
    if (typeof o.payload?.thread_source === "string") acc.threadSource = o.payload.thread_source;
    acc.startedAt ??=
      isoFromTimestamp(o.payload?.timestamp ?? o.timestamp ?? o.payload?.created_at) ?? undefined;
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

  if (o?.type === "event_msg") {
    const payload = o.payload;
    if (payload?.type === "task_started" && typeof payload.turn_id === "string") {
      acc.turnIds.add(payload.turn_id);
      acc.startedAt ??= isoFromTimestamp(payload.started_at ?? o.timestamp) ?? undefined;
    } else if (payload?.type === "user_message" && typeof payload.message === "string") {
      applyUserText(payload.message, acc);
    } else if (payload?.type === "task_complete" && typeof payload.last_agent_message === "string") {
      const text = payload.last_agent_message.trim();
      if (text) acc.lastAssistantText = text;
    }
    return;
  }

  if (o?.type !== "response_item") return;
  const payload = o.payload;
  if (payload?.type !== "message") return;
  if (payload.role === "user") {
    const rawText = textFromContent(payload.content);
    if (rawText && isInjectedCodexText(rawText)) {
      acc.sessionKind = preferSessionKind(acc.sessionKind, "system");
    }
    const text = userTextFromContent(payload.content);
    if (text) applyUserText(text, acc);
  } else if (payload.role === "assistant") {
    const text = textFromContent(payload.content);
    if (!text) return;
    acc.lastAssistantFallbackText = text;
    if (payload.phase === "final_answer") acc.lastFinalAnswerText = text;
  }
}

interface CodexSessionFileCacheEntry {
  size: number;
  mtimeMs: number;
  summary: CodexSessionSummary;
}

const sessionFileCache = new Map<string, CodexSessionFileCacheEntry>();

async function readCodexSession(filePath: string): Promise<CodexSessionSummary | null> {
  const stat = await statOrNull(filePath);
  if (!stat) return null;
  const cached = sessionFileCache.get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) return cached.summary;
  const basename = path.basename(filePath, ".jsonl");
  const localId = basename.match(/([0-9a-f]{8}-[0-9a-f-]{27,})$/i)?.[1] ?? basename;
  const acc: CodexSessionSummary = {
    id: `codex:${localId}`,
    localId,
    projectId: undefined,
    sessionKind: "unknown",
    originator: undefined,
    source: undefined,
    threadSource: undefined,
    cwd: undefined,
    model: undefined,
    title: undefined,
    firstUserText: undefined,
    updatedAt: iso(stat.mtimeMs),
    startedAt: undefined,
    turnCount: undefined,
    turnIds: new Set<string>(),
    completeScan: false,
    lastUserText: undefined,
    lastAssistantText: undefined,
    lastFinalAnswerText: undefined,
    lastAssistantFallbackText: undefined,
    sourcePath: filePath,
  };

  try {
    const { chunks, complete } = await readSessionChunks(filePath, stat.size);
    acc.completeScan = complete;
    for (const chunk of chunks) {
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) applyCodexLine(line, acc);
    }
    acc.lastAssistantText ??= acc.lastFinalAnswerText ?? acc.lastAssistantFallbackText;
    sessionFileCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, summary: acc });
    return acc;
  } catch {
    return cached?.summary ?? null;
  }
}

function sessionKindRank(kind: SessionKind): number {
  if (kind === "main") return 3;
  if (kind === "worker") return 2;
  if (kind === "system") return 1;
  return 0;
}

function newerSession(a: CodexSessionSummary, b: CodexSessionSummary): CodexSessionSummary {
  return parseTimeMs(b.updatedAt) >= parseTimeMs(a.updatedAt) ? b : a;
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
  const startedAt = [a.startedAt, b.startedAt]
    .filter((value): value is string => Boolean(value))
    .sort((x, y) => parseTimeMs(x) - parseTimeMs(y))[0];
  return {
    ...latest,
    sessionKind: preferSessionKind(a.sessionKind, b.sessionKind),
    title: userFacing.title ?? latest.title,
    firstUserText: userFacing.firstUserText ?? latest.firstUserText,
    lastUserText: userFacing.lastUserText ?? latest.lastUserText,
    lastAssistantText: userFacing.lastAssistantText ?? latest.lastAssistantText,
    startedAt,
    turnCount: a.turnCount ?? b.turnCount,
    turnIds: new Set([...a.turnIds, ...b.turnIds]),
    completeScan: a.completeScan && b.completeScan,
    sourcePath: userFacing.sourcePath,
  };
}

function stateThreadSummary(thread: CodexStateThread): CodexSessionSummary {
  return {
    id: `codex:${thread.id}`,
    localId: thread.id,
    projectId: `codex:${localProjectIdFromCwd(thread.cwd)}`,
    sessionKind: "unknown",
    originator: undefined,
    source: thread.source,
    threadSource: thread.threadSource,
    cwd: thread.cwd,
    model: thread.model,
    title: thread.title || undefined,
    firstUserText: undefined,
    updatedAt: isoFromTimestamp(thread.updatedAt) ?? iso(0),
    startedAt: isoFromTimestamp(thread.createdAt) ?? undefined,
    turnCount: undefined,
    turnIds: new Set<string>(),
    completeScan: false,
    lastUserText: undefined,
    lastAssistantText: undefined,
    lastFinalAnswerText: undefined,
    lastAssistantFallbackText: undefined,
    sourcePath: thread.rolloutPath,
  };
}

function overlayStateThread(session: CodexSessionSummary, thread: CodexStateThread): CodexSessionSummary {
  const state = stateThreadSummary(thread);
  const updatedAt =
    parseTimeMs(state.updatedAt) > parseTimeMs(session.updatedAt) ? state.updatedAt : session.updatedAt;
  const startedAt = [session.startedAt, state.startedAt]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => parseTimeMs(a) - parseTimeMs(b))[0];
  return {
    ...session,
    projectId: session.projectId ?? state.projectId,
    source: session.source ?? state.source,
    threadSource: session.threadSource ?? state.threadSource,
    cwd: session.cwd ?? state.cwd,
    model: session.model ?? state.model,
    title: session.title ?? state.title,
    updatedAt,
    startedAt,
    sourcePath: session.sourcePath || state.sourcePath,
  };
}

function isImportedDesktopLog(session: CodexSessionSummary): boolean {
  return session.originator === "Codex Desktop" && session.source === "vscode" && !session.model;
}

function finalizeCodexSessionKind(
  session: CodexSessionSummary,
  hasHistory: boolean,
): CodexSessionSummary {
  if (session.originator === "Claude Code" && session.source === "vscode") {
    return { ...session, sessionKind: "imported" };
  }
  if (isImportedDesktopLog(session)) {
    return { ...session, sessionKind: "system" };
  }
  if (session.threadSource === "subagent") {
    return { ...session, sessionKind: "worker" };
  }
  if (session.threadSource === "user" || hasHistory) {
    return { ...session, sessionKind: "main" };
  }
  return session;
}

async function readCodexSessionsUncached(): Promise<CodexSessionSummary[]> {
  const files = await listSessionFiles();
  const liveFiles = new Set(files);
  for (const cachedPath of sessionFileCache.keys()) {
    if (!liveFiles.has(cachedPath)) sessionFileCache.delete(cachedPath);
  }
  const rawSessions = (await Promise.all(files.map((file) => readCodexSession(file)))).filter(
    (s): s is CodexSessionSummary => Boolean(s),
  );
  const [history, sessionIndex, stateThreads] = await Promise.all([
    readCodexHistory(),
    readCodexSessionIndex(),
    readCodexStateThreads(),
  ]);
  const byId = new Map<string, CodexSessionSummary>();
  for (const session of rawSessions) {
    const prev = byId.get(session.id);
    byId.set(session.id, prev ? mergeCodexSessionSummary(prev, session) : session);
  }
  for (const thread of stateThreads) {
    const id = `codex:${thread.id}`;
    const prev = byId.get(id);
    byId.set(id, prev ? overlayStateThread(prev, thread) : stateThreadSummary(thread));
  }
  const sessions = [...byId.values()];
  return sessions
    .filter(
      (session) =>
        session.cwd || session.lastUserText || session.lastAssistantText || history.has(session.localId),
    )
    .map((session) => {
      const h = history.get(session.localId);
      const indexed = sessionIndex.get(session.localId);
      const updateCandidates = [session.updatedAt, h?.lastAt, indexed?.updatedAt].filter(
        (value): value is string => Boolean(value),
      );
      const updatedAt = updateCandidates.sort((a, b) => parseTimeMs(b) - parseTimeMs(a))[0] ?? session.updatedAt;
      const overlaid: CodexSessionSummary = {
        ...session,
        title: indexed?.threadName ?? h?.firstText ?? session.firstUserText ?? session.title,
        firstUserText: h?.firstText ?? session.firstUserText,
        lastUserText: h?.lastText ?? session.lastUserText,
        startedAt: session.startedAt ?? h?.firstAt,
        turnCount: h?.turnCount ?? (session.completeScan ? session.turnIds.size || undefined : undefined),
        updatedAt,
      };
      return finalizeCodexSessionKind(overlaid, Boolean(h));
    })
    .sort((a, b) => parseTimeMs(b.updatedAt) - parseTimeMs(a.updatedAt));
}

let sessionSnapshot:
  | { expiresAt: number; value: CodexSessionSummary[] }
  | { expiresAt: number; promise: Promise<CodexSessionSummary[]> }
  | null = null;

async function readCodexSessions(): Promise<CodexSessionSummary[]> {
  const now = Date.now();
  if (sessionSnapshot && sessionSnapshot.expiresAt > now) {
    if ("value" in sessionSnapshot) return sessionSnapshot.value;
    return sessionSnapshot.promise;
  }
  const promise = readCodexSessionsUncached().then((value) => {
    sessionSnapshot = { expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS, value };
    return value;
  });
  sessionSnapshot = { expiresAt: now + WORKSPACE_CACHE_TTL_MS, promise };
  return promise;
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
        kind: "instruction" as const,
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
        kind: "memory" as const,
        description: "Codex memory file",
        path: p,
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }
    const skillsRoot = path.join(CODEX_HOME, "skills");
    async function walkSkills(dir: string): Promise<void> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkSkills(full);
          continue;
        }
        if (!entry.isFile() || entry.name !== "SKILL.md") continue;
        const stat = await fs.stat(full).catch(() => null);
        if (!stat) continue;
        const raw = await fs.readFile(full, "utf8").catch(() => "");
        let description = "";
        try {
          description = raw ? ((matter(raw).data?.description as string | undefined) ?? "") : "";
        } catch {
          // 잘못된 frontmatter 하나가 전체 Catalog를 가리지 않게 설명만 비운다.
        }
        items.push({
          name: path.relative(skillsRoot, path.dirname(full)).split(path.sep).join("/"),
          kind: "skill" as const,
          description,
          path: full,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
      }
    }
    await walkSkills(skillsRoot);
    return items;
  },
  async listProjects() {
    const byProject = new Map<
      string,
      { localId: string; title: string; realPath: string | null; latestActivityAt: string | null }
    >();
    for (const session of await readCodexSessions()) {
      if (session.sessionKind !== "main") continue;
      const localId = session.cwd ? localProjectIdFromCwd(session.cwd) : "unknown";
      const id = `codex:${localId}`;
      const prev = byProject.get(id);
      if (!prev || parseTimeMs(session.updatedAt) > parseTimeMs(prev.latestActivityAt)) {
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
      .sort((a, b) => parseTimeMs(b.latestActivityAt) - parseTimeMs(a.latestActivityAt));
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
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      turnCount: session.turnCount,
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
