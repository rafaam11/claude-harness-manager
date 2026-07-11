import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  APP_BACKUP_DIR,
  APP_STATE_DIR,
  CODEX_HOME,
  CONFIG_FILES,
  PROJECTS_DIR,
} from "../config.js";
import { validateConfig } from "../lib/json-validate.js";
import { guardPath } from "../lib/path-guard.js";
import { parseTimeMs } from "../lib/time.js";
import { readConfig, safeWrite } from "../lib/safe-write.js";
import type { ProviderFilter } from "@shared/provider-types";
import type {
  UsageCaptureStatus,
  UsageQuotaSummary,
  UsageQuotaWindow,
  UsageSummary,
  UsageTokenSummary,
  UsageTokenWindow,
} from "@shared/usage-types";

const FIVE_HOUR_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FIVE_HOUR_MINUTES = 300;
const WEEK_MINUTES = 10080;
const DEFAULT_STALE_MS = 15 * 60 * 1000;

const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, "sessions");
const USAGE_DIR = path.join(APP_STATE_DIR, "usage");
const CLAUDE_USAGE_SNAPSHOT_FILE = path.join(USAGE_DIR, "claude-usage-snapshot.json");
const CLAUDE_USAGE_PROXY_FILE = path.join(USAGE_DIR, "claude-usage-proxy.mjs");
const CLAUDE_USAGE_PROXY_STATE_FILE = path.join(USAGE_DIR, "claude-usage-proxy-state.json");

type TokenCounts = Omit<UsageTokenWindow, "since" | "until" | "eventCount">;

export interface ParsedUsageEvent {
  provider: "claude" | "codex";
  timestamp: string;
  tokens: TokenCounts;
  dedupeKey: string;
  quota?: ParsedQuotaObservation;
}

export interface ParsedQuotaObservation {
  observedAt: string;
  stale: boolean;
  fiveHour: UsageQuotaWindow;
  weekly: UsageQuotaWindow;
  planType: string | null;
}

interface CaptureState {
  version: 1;
  proxyCommand: string;
  originalCommand: string | null;
  /**
   * proxy가 originalCommand를 forward할 때 쓸 셸(절대경로). Windows에서 bash 문법 statusLine을
   * cmd.exe로 실행하면 깨지므로 setup 시점에 git-bash 경로를 계산해 박아둔다. null/미지정이면
   * proxy가 shell:true(win32=cmd.exe, POSIX=/bin/sh)로 폴백한다.
   */
  forwardShell?: string | null;
  originalStatusLine?: unknown;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function percentValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = numberValue(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
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

function emptyCounts(): TokenCounts {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addCounts(target: TokenCounts, source: TokenCounts): void {
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
}

function tokenWindow(events: ParsedUsageEvent[], nowMs: number, windowMs: number): UsageTokenWindow {
  const sinceMs = nowMs - windowMs;
  const counts = emptyCounts();
  let eventCount = 0;
  for (const event of dedupeEvents(events)) {
    const ts = Date.parse(event.timestamp);
    if (!Number.isFinite(ts) || ts < sinceMs || ts > nowMs) continue;
    addCounts(counts, event.tokens);
    eventCount += 1;
  }
  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(nowMs).toISOString(),
    ...counts,
    eventCount,
  };
}

function dedupeEvents(events: ParsedUsageEvent[]): ParsedUsageEvent[] {
  const seen = new Set<string>();
  const out: ParsedUsageEvent[] = [];
  for (const event of events) {
    const key = `${event.provider}:${event.dedupeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function buildTokenSummary(events: ParsedUsageEvent[], nowMs: number): UsageTokenSummary {
  return {
    fiveHour: tokenWindow(events, nowMs, FIVE_HOUR_MS),
    weekly: tokenWindow(events, nowMs, WEEK_MS),
  };
}

function unavailableQuota(message: string): UsageQuotaSummary {
  return {
    source: "unavailable",
    observedAt: null,
    stale: true,
    planType: null,
    fiveHour: { usedPercent: null, windowMinutes: FIVE_HOUR_MINUTES, resetAt: null },
    weekly: { usedPercent: null, windowMinutes: WEEK_MINUTES, resetAt: null },
    message,
  };
}

function quotaWindow(raw: unknown, fallbackMinutes: number): UsageQuotaWindow {
  const r = isRecord(raw) ? raw : {};
  const resetAt =
    isoFromTimestamp(r.resets_at) ??
    isoFromTimestamp(r.reset_at) ??
    isoFromTimestamp(r.resetAt) ??
    null;
  return {
    usedPercent:
      percentValue(r.used_percent) ??
      percentValue(r.used_percentage) ??
      percentValue(r.usedPercent) ??
      null,
    windowMinutes: numberValue(r.window_minutes ?? r.windowMinutes) || fallbackMinutes,
    resetAt,
  };
}

function tokensFromCodexUsage(raw: unknown): TokenCounts | null {
  if (!isRecord(raw)) return null;
  const input = numberValue(raw.input_tokens ?? raw.inputTokens);
  const cached = numberValue(raw.cached_input_tokens ?? raw.cachedInputTokens);
  const output = numberValue(raw.output_tokens ?? raw.outputTokens);
  const reasoning = numberValue(raw.reasoning_output_tokens ?? raw.reasoningOutputTokens);
  const explicitTotal = numberValue(raw.total_tokens ?? raw.totalTokens);
  const total = explicitTotal || input + output + reasoning;
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: output,
    reasoningOutputTokens: reasoning,
    totalTokens: total,
  };
}

function tokensFromClaudeUsage(raw: unknown): TokenCounts | null {
  if (!isRecord(raw)) return null;
  const input = numberValue(raw.input_tokens ?? raw.inputTokens);
  const creation = numberValue(raw.cache_creation_input_tokens ?? raw.cacheCreationInputTokens);
  const read = numberValue(raw.cache_read_input_tokens ?? raw.cacheReadInputTokens);
  const output = numberValue(raw.output_tokens ?? raw.outputTokens);
  const explicitTotal = numberValue(raw.total_tokens ?? raw.totalTokens);
  const total = explicitTotal || input + creation + read + output;
  return {
    inputTokens: input,
    cachedInputTokens: creation + read,
    cacheCreationInputTokens: creation,
    cacheReadInputTokens: read,
    outputTokens: output,
    reasoningOutputTokens: 0,
    totalTokens: total,
  };
}

export function parseCodexUsageLine(line: string, sourcePath = "codex-log"): ParsedUsageEvent | null {
  if (!line.trim()) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(obj)) return null;
  const payload = isRecord(obj.payload) ? obj.payload : {};
  if (obj.type !== "event_msg" || payload.type !== "token_count") return null;
  const info = isRecord(payload.info) ? payload.info : {};
  const tokens = tokensFromCodexUsage(info.last_token_usage ?? info.token_usage ?? payload.usage);
  if (!tokens) return null;
  const timestamp =
    isoFromTimestamp(obj.timestamp) ?? isoFromTimestamp(payload.timestamp) ?? new Date().toISOString();
  const rateLimits = isRecord(obj.rate_limits)
    ? obj.rate_limits
    : isRecord(payload.rate_limits)
      ? payload.rate_limits
      : {};
  const primary = isRecord(rateLimits.primary) ? rateLimits.primary : {};
  const secondary = isRecord(rateLimits.secondary) ? rateLimits.secondary : {};
  return {
    provider: "codex",
    timestamp,
    tokens,
    dedupeKey: `${sourcePath}:${timestamp}:${line}`,
    quota: {
      observedAt: timestamp,
      stale: false,
      fiveHour: quotaWindow(primary, FIVE_HOUR_MINUTES),
      weekly: quotaWindow(secondary, WEEK_MINUTES),
      planType: typeof rateLimits.plan_type === "string" ? rateLimits.plan_type : null,
    },
  };
}

export function parseClaudeUsageLine(
  line: string,
  sourcePath = "claude-log",
  fallbackMtime = Date.now(),
): ParsedUsageEvent | null {
  if (!line.trim()) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(obj) || obj.type !== "assistant" || !isRecord(obj.message)) return null;
  const usage = tokensFromClaudeUsage(obj.message.usage);
  if (!usage) return null;
  const timestamp =
    isoFromTimestamp(obj.timestamp) ??
    isoFromTimestamp(obj.message.created_at) ??
    new Date(fallbackMtime).toISOString();
  const id = typeof obj.message.id === "string" && obj.message.id ? obj.message.id : null;
  return {
    provider: "claude",
    timestamp,
    tokens: usage,
    dedupeKey: id ?? `${sourcePath}:${timestamp}:${line}`,
  };
}

export function parseUsageSnapshot(
  content: string,
  nowMs = Date.now(),
  staleMs = DEFAULT_STALE_MS,
): ParsedQuotaObservation | null {
  let obj: unknown;
  try {
    obj = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(obj)) return null;
  const observedAt =
    isoFromTimestamp(obj.updated_at) ??
    isoFromTimestamp(obj.updatedAt) ??
    isoFromTimestamp(obj.timestamp);
  if (!observedAt) return null;
  return {
    observedAt,
    stale: nowMs - parseTimeMs(observedAt) > staleMs,
    fiveHour: quotaWindow(obj.five_hour ?? obj.fiveHour ?? obj.primary, FIVE_HOUR_MINUTES),
    weekly: quotaWindow(obj.seven_day ?? obj.weekly ?? obj.secondary, WEEK_MINUTES),
    planType: typeof obj.plan_type === "string" ? obj.plan_type : null,
  };
}

export function buildCodexUsageSummary(
  events: Array<ParsedUsageEvent | null>,
  nowMs = Date.now(),
): UsageSummary {
  const valid = events.filter((e): e is ParsedUsageEvent => Boolean(e));
  const latestQuota = valid
    .map((event) => event.quota)
    .filter((q): q is ParsedQuotaObservation => Boolean(q))
    .sort((a, b) => parseTimeMs(b.observedAt) - parseTimeMs(a.observedAt))[0];
  return {
    provider: "codex",
    label: "Codex",
    quota: latestQuota
      ? {
          source: "codex-log",
          observedAt: latestQuota.observedAt,
          stale: nowMs - parseTimeMs(latestQuota.observedAt) > DEFAULT_STALE_MS,
          planType: latestQuota.planType,
          fiveHour: latestQuota.fiveHour,
          weekly: latestQuota.weekly,
        }
      : unavailableQuota("Codex token_count 로그가 아직 없습니다."),
    tokens: buildTokenSummary(valid, nowMs),
    errors: [],
  };
}

export function buildClaudeUsageSummary(
  events: Array<ParsedUsageEvent | null>,
  snapshot: ParsedQuotaObservation | null,
  nowMs = Date.now(),
  capture?: UsageCaptureStatus,
): UsageSummary {
  const valid = events.filter((e): e is ParsedUsageEvent => Boolean(e));
  return {
    provider: "claude",
    label: "Claude Code",
    quota: snapshot
      ? {
          source: "claude-statusline",
          observedAt: snapshot.observedAt,
          stale: snapshot.stale,
          planType: snapshot.planType,
          fiveHour: snapshot.fiveHour,
          weekly: snapshot.weekly,
        }
      : unavailableQuota("Claude 한도 %는 statusLine 캡처 설정 후 표시됩니다."),
    tokens: buildTokenSummary(valid, nowMs),
    capture,
    errors: [],
  };
}

export function buildClaudeCaptureSettings(
  current: Record<string, unknown>,
  proxyCommand: string,
): {
  next: Record<string, unknown>;
  originalCommand: string | null;
  changed: boolean;
  alreadyEnabled: boolean;
} {
  const statusLine = isRecord(current.statusLine) ? current.statusLine : null;
  const command = typeof statusLine?.command === "string" ? statusLine.command : null;
  if (command === proxyCommand) {
    return { next: current, originalCommand: null, changed: false, alreadyEnabled: true };
  }
  return {
    next: { ...current, statusLine: { type: "command", command: proxyCommand } },
    originalCommand: command,
    changed: true,
    alreadyEnabled: false,
  };
}

export function restoreClaudeCaptureSettings(
  current: Record<string, unknown>,
  proxyCommand: string,
  originalCommand: string | null,
): { next: Record<string, unknown>; changed: boolean; conflict: boolean } {
  const statusLine = isRecord(current.statusLine) ? current.statusLine : null;
  const command = typeof statusLine?.command === "string" ? statusLine.command : null;
  if (command !== proxyCommand) return { next: current, changed: false, conflict: true };
  if (originalCommand) {
    return {
      next: { ...current, statusLine: { type: "command", command: originalCommand } },
      changed: true,
      conflict: false,
    };
  }
  const next = { ...current };
  delete next.statusLine;
  return { next, changed: true, conflict: false };
}

function quoteCommandPath(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

function claudeProxyCommand(): string {
  return `node ${quoteCommandPath(CLAUDE_USAGE_PROXY_FILE)}`;
}

/**
 * bash/sh 문법 신호(명령 치환·파라미터 확장·/dev/ 리다이렉트·exec·MSYS 절대경로)를 포함하면
 * cmd.exe로는 실행할 수 없고 POSIX 셸이 필요하다. 순수 Windows 명령엔 이런 토큰이 없다.
 */
export function commandNeedsPosixShell(command: string): boolean {
  return (
    /\$\(/.test(command) || // $(...)
    /\$\{/.test(command) || // ${...}
    /[<>]\s*\/dev\//.test(command) || // </dev/tty, 2>/dev/null
    /(^|[\s;&|(])exec\s/.test(command) || // exec ...
    /(^|\s)\/[a-zA-Z]\//.test(command) // /c/... MSYS 스타일 절대경로
  );
}

/** 알려진 Git for Windows 설치 위치에서 bash.exe를 찾는다(WSL bash는 경로 스타일이 달라 제외). */
function defaultFindGitBash(): string | null {
  if (process.platform !== "win32") return null;
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const candidates = [
    path.join(pf, "Git", "bin", "bash.exe"),
    path.join(pf, "Git", "usr", "bin", "bash.exe"),
    path.join(pf86, "Git", "bin", "bash.exe"),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      // 접근 불가 후보는 건너뛴다
    }
  }
  return null;
}

/**
 * proxy가 statusLine을 forward할 셸 경로를 결정한다. Windows + bash 문법 명령일 때만 git-bash를
 * 반환하고(Claude Code 본체가 실행하던 셸과 일치), 그 외(POSIX·순수 cmd·bash 미발견)엔 null을
 * 반환해 proxy가 shell:true로 폴백하게 한다. findGitBash는 테스트를 위해 주입 가능.
 */
export function resolveForwardShell(
  originalCommand: string | null,
  platform: NodeJS.Platform,
  findGitBash: () => string | null = defaultFindGitBash,
): string | null {
  if (!originalCommand) return null;
  if (platform !== "win32") return null; // POSIX는 shell:true(=/bin/sh)로 충분
  if (!commandNeedsPosixShell(originalCommand)) return null; // 순수 cmd 명령은 cmd.exe 유지
  return findGitBash();
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  const raw = await fs.readFile(guardPath(filePath), "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const p = guardPath(filePath);
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.chm-tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, p);
}

async function writeSettingsJson(next: Record<string, unknown>): Promise<void> {
  const text = `${JSON.stringify(next, null, 2)}\n`;
  validateConfig("settings", text);
  const settingsPath = CONFIG_FILES.settings.path;
  try {
    const current = await readConfig(settingsPath);
    await safeWrite("settings", settingsPath, text, current.sha256, {
      backupDir: APP_BACKUP_DIR,
      validate: () => validateConfig("settings", text),
    });
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw error;
    await writeAtomic(settingsPath, text);
  }
}

async function readCaptureState(): Promise<CaptureState | null> {
  const raw = await readJsonObject(CLAUDE_USAGE_PROXY_STATE_FILE);
  if (!raw) return null;
  return {
    version: 1,
    proxyCommand: typeof raw.proxyCommand === "string" ? raw.proxyCommand : claudeProxyCommand(),
    originalCommand: typeof raw.originalCommand === "string" ? raw.originalCommand : null,
    forwardShell: typeof raw.forwardShell === "string" ? raw.forwardShell : null,
    originalStatusLine: raw.originalStatusLine,
    updatedAt:
      typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

async function readCaptureStatus(changed = false, message?: string): Promise<UsageCaptureStatus> {
  const settings = (await readJsonObject(CONFIG_FILES.settings.path)) ?? {};
  const statusLine = isRecord(settings.statusLine) ? settings.statusLine : {};
  const command = typeof statusLine.command === "string" ? statusLine.command : null;
  const proxyCommand = claudeProxyCommand();
  const state = await readCaptureState();
  return {
    provider: "claude",
    enabled: command === proxyCommand,
    settingsPath: CONFIG_FILES.settings.path,
    snapshotPath: CLAUDE_USAGE_SNAPSHOT_FILE,
    proxyPath: CLAUDE_USAGE_PROXY_FILE,
    proxyCommand,
    originalCommand: state?.originalCommand ?? null,
    changed,
    message,
  };
}

function proxyScript(): string {
  return `import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const snapshotPath = ${JSON.stringify(CLAUDE_USAGE_SNAPSHOT_FILE)};
const statePath = ${JSON.stringify(CLAUDE_USAGE_PROXY_STATE_FILE)};

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pickWindow(root, names) {
  for (const name of names) {
    if (root && typeof root === "object" && root[name]) return asRecord(root[name]);
  }
  return {};
}

function pickPercent(window) {
  return window.used_percentage ?? window.used_percent ?? window.usedPercent ?? null;
}

function pickReset(window) {
  return window.resets_at ?? window.reset_at ?? window.resetAt ?? null;
}

function iso(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10000000000 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

async function writeSnapshot(stdinText) {
  let input;
  try {
    input = JSON.parse(stdinText || "{}");
  } catch {
    return;
  }
  const limits = asRecord(input.rate_limits ?? input.rateLimits ?? input.limits ?? input.usage);
  const five = pickWindow(limits, ["five_hour", "fiveHour", "primary"]);
  const week = pickWindow(limits, ["seven_day", "weekly", "secondary"]);
  const hasSignal =
    pickPercent(five) !== null ||
    pickPercent(week) !== null ||
    pickReset(five) !== null ||
    pickReset(week) !== null;
  if (!hasSignal) return;
  const snapshot = {
    updated_at: new Date().toISOString(),
    plan_type: limits.plan_type ?? limits.planType ?? null,
    five_hour: { used_percentage: pickPercent(five), resets_at: iso(pickReset(five)) },
    seven_day: { used_percentage: pickPercent(week), resets_at: iso(pickReset(week)) },
  };
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  const tmp = snapshotPath + ".tmp-" + process.pid;
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2) + "\\n", "utf8");
  await fs.rename(tmp, snapshotPath);
}

async function forward(stdinText) {
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8"));
  } catch {}
  if (!state.originalCommand) return 0;
  // forwardShell(setup 시점에 계산한 git-bash 경로)이 있으면 그 셸로, 없으면 shell:true 폴백.
  // Windows에서 bash 문법 statusLine을 cmd.exe(shell:true)로 실행하면 깨지므로 필요하다.
  const shell = typeof state.forwardShell === "string" && state.forwardShell ? state.forwardShell : true;
  return await new Promise((resolve) => {
    const child = spawn(state.originalCommand, {
      shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 0));
    child.stdin.end(stdinText);
  });
}

const stdinText = await readStdin();
await writeSnapshot(stdinText).catch(() => {});
process.exit(await forward(stdinText));
`;
}

async function listJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(guardPath(dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(full);
    }
  }
  await walk(root);
  return files;
}

type UsageFileReader = (
  file: string,
) => Promise<{ mtimeMs: number; lines: AsyncIterable<string> }>;

const defaultUsageFileReader: UsageFileReader = async (file) => {
  const p = guardPath(file);
  const handle = await fs.open(p, "r");
  const stat = await handle.stat();
  return {
    mtimeMs: stat.mtimeMs,
    lines: readline.createInterface({ input: handle.createReadStream(), crlfDelay: Infinity }),
  };
};

export async function readUsageEvents(
  files: string[],
  parseLine: (line: string, sourcePath: string, fallbackMtime: number) => ParsedUsageEvent | null,
  openFile: UsageFileReader = defaultUsageFileReader,
): Promise<{ events: ParsedUsageEvent[]; errors: string[] }> {
  const events: ParsedUsageEvent[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      const source = await openFile(file);
      for await (const line of source.lines) {
        const event = parseLine(String(line), file, source.mtimeMs);
        if (event) events.push(event);
      }
    } catch (error) {
      errors.push(`${file}: ${(error as Error).message}`);
    }
  }
  return { events, errors };
}

async function readClaudeSnapshot(nowMs: number): Promise<ParsedQuotaObservation | null> {
  const raw = await fs.readFile(guardPath(CLAUDE_USAGE_SNAPSHOT_FILE), "utf8").catch(() => null);
  return raw ? parseUsageSnapshot(raw, nowMs, DEFAULT_STALE_MS) : null;
}

async function getClaudeUsage(nowMs: number): Promise<UsageSummary> {
  const errors: string[] = [];
  const files = await listJsonlFiles(PROJECTS_DIR).catch((error) => {
    errors.push((error as Error).message);
    return [] as string[];
  });
  const usage = await readUsageEvents(files, parseClaudeUsageLine);
  errors.push(...usage.errors);
  const snapshot = await readClaudeSnapshot(nowMs).catch((error) => {
    errors.push((error as Error).message);
    return null;
  });
  const capture = await readCaptureStatus().catch(() => undefined);
  const summary = buildClaudeUsageSummary(usage.events, snapshot, nowMs, capture);
  return { ...summary, errors };
}

async function getCodexUsage(nowMs: number): Promise<UsageSummary> {
  const errors: string[] = [];
  const files = await listJsonlFiles(CODEX_SESSIONS_DIR).catch((error) => {
    errors.push((error as Error).message);
    return [] as string[];
  });
  const usage = await readUsageEvents(files, parseCodexUsageLine);
  errors.push(...usage.errors);
  const summary = buildCodexUsageSummary(usage.events, nowMs);
  return { ...summary, errors };
}

export async function getUsageSummaries(filter: ProviderFilter): Promise<UsageSummary[]> {
  const nowMs = Date.now();
  const tasks: Promise<UsageSummary>[] = [];
  if (filter === "all" || filter === "claude") tasks.push(getClaudeUsage(nowMs));
  if (filter === "all" || filter === "codex") tasks.push(getCodexUsage(nowMs));
  return Promise.all(tasks);
}

export async function setupClaudeUsageCapture(): Promise<UsageCaptureStatus> {
  const settings = (await readJsonObject(CONFIG_FILES.settings.path)) ?? {};
  const proxyCommand = claudeProxyCommand();
  const setup = buildClaudeCaptureSettings(settings, proxyCommand);
  const originalCommand = setup.alreadyEnabled
    ? (await readCaptureState())?.originalCommand ?? null
    : setup.originalCommand;
  const state: CaptureState = {
    version: 1,
    proxyCommand,
    originalCommand,
    forwardShell: resolveForwardShell(originalCommand, process.platform),
    originalStatusLine: setup.alreadyEnabled ? (await readCaptureState())?.originalStatusLine : settings.statusLine,
    updatedAt: new Date().toISOString(),
  };
  await writeAtomic(CLAUDE_USAGE_PROXY_FILE, proxyScript());
  await writeAtomic(CLAUDE_USAGE_PROXY_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  if (setup.changed) await writeSettingsJson(setup.next);
  return readCaptureStatus(setup.changed, setup.alreadyEnabled ? "이미 캡처가 켜져 있습니다." : undefined);
}

export async function disableClaudeUsageCapture(): Promise<UsageCaptureStatus> {
  const settings = (await readJsonObject(CONFIG_FILES.settings.path)) ?? {};
  const state = await readCaptureState();
  const proxyCommand = state?.proxyCommand ?? claudeProxyCommand();
  let restored = restoreClaudeCaptureSettings(settings, proxyCommand, state?.originalCommand ?? null);
  if (
    restored.changed &&
    !state?.originalCommand &&
    state &&
    "originalStatusLine" in state &&
    state.originalStatusLine !== undefined
  ) {
    restored = {
      next: { ...settings, statusLine: state.originalStatusLine },
      changed: true,
      conflict: false,
    };
  }
  if (restored.changed) await writeSettingsJson(restored.next);
  const status = await readCaptureStatus(restored.changed);
  return { ...status, conflict: restored.conflict, message: restored.conflict ? "현재 statusLine이 앱 proxy가 아니라 원복하지 않았습니다." : undefined };
}
