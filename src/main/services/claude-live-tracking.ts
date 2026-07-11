import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  APP_HOOKS_DIR,
  CLAUDE_LIVE_SESSION_HOOK_FILE,
  CONFIG_FILES,
  LIVE_SESSION_RECORD_TTL_MS,
  LIVE_SESSIONS_DIR,
} from "../config.js";
import { guardPath } from "../lib/path-guard.js";
import { withLock } from "../lib/lock.js";
import { readConfig, safeWrite } from "../lib/safe-write.js";
import type { ClaudeLiveTrackingStatus } from "@shared/provider-types";

export interface ClaudeLiveSessionRecord {
  sessionId: string;
  cwd: string | null;
  transcriptPath: string;
  model: string | null;
  processPid: number;
  processStartToken: string;
  startedAt: string;
  endedAt?: string;
}

// SessionStart/End만으로는 hook 설치 이전부터 돌던 세션을 영영 못 잡는다.
// UserPromptSubmit이 있어야 그런 세션도 다음 입력에서 즉시 잡힌다.
const HOOK_EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit"] as const;
// 앱이 "설치됨"으로 인정하는 최소 집합. 나머지는 outdated로 보고 업그레이드를 권한다.
const LEGACY_HOOK_EVENTS = ["SessionStart", "SessionEnd"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hookCommand(): string {
  return `node "${CLAUDE_LIVE_SESSION_HOOK_FILE}"`;
}

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function ensureHookRoot(settings: Record<string, unknown>): Record<string, unknown> {
  const hooks = settings.hooks;
  if (hooks === undefined) {
    const next: Record<string, unknown> = {};
    settings.hooks = next;
    return next;
  }
  if (!isRecord(hooks)) throw new Error("Claude hooks 설정 형식이 올바르지 않습니다.");
  return hooks;
}

function hasCommand(groups: unknown, command: string): boolean {
  if (!Array.isArray(groups)) return false;
  return groups.some(
    (group) =>
      isRecord(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some((hook) => isRecord(hook) && hook.type === "command" && hook.command === command),
  );
}

/** 기존 사용자 hook을 건드리지 않고 app 소유 hook만 병합한다. */
export function mergeClaudeLiveTrackingHooks(settings: unknown, command = hookCommand()): Record<string, unknown> {
  if (!isRecord(settings)) throw new Error("Claude settings.json 최상위는 객체여야 합니다.");
  const next = cloneObject(settings);
  const hooks = ensureHookRoot(next);
  for (const event of HOOK_EVENTS) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) {
      throw new Error(`${event} hook 설정 형식이 올바르지 않습니다.`);
    }
    if (hasCommand(groups, command)) continue;
    const nextGroups = Array.isArray(groups) ? [...groups] : [];
    nextGroups.push({ hooks: [{ type: "command", command, timeout: 5 }] });
    hooks[event] = nextGroups;
  }
  return next;
}

/** app 소유 command만 제거하고 다른 사용자 hook과 event 설정은 보존한다. */
export function removeClaudeLiveTrackingHooks(settings: unknown, command = hookCommand()): Record<string, unknown> {
  if (!isRecord(settings)) throw new Error("Claude settings.json 최상위는 객체여야 합니다.");
  const next = cloneObject(settings);
  if (!isRecord(next.hooks)) return next;
  for (const event of HOOK_EVENTS) {
    const groups = next.hooks[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) return group;
        const hooks = group.hooks.filter(
          (hook) => !(isRecord(hook) && hook.type === "command" && hook.command === command),
        );
        return { ...group, hooks };
      })
      .filter((group) => !isRecord(group) || !Array.isArray(group.hooks) || group.hooks.length > 0);
    if (kept.length) next.hooks[event] = kept;
    else delete next.hooks[event];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

/**
 * 설치 상태. `installed`는 예전 버전(SessionStart/End만)도 인정하되,
 * UserPromptSubmit이 빠졌으면 `outdated`로 표시해 앱이 업그레이드를 권하게 한다.
 */
export function claudeLiveTrackingState(
  settings: unknown,
  command = hookCommand(),
): { installed: boolean; outdated: boolean } {
  if (!isRecord(settings) || !isRecord(settings.hooks)) return { installed: false, outdated: false };
  const hooks = settings.hooks;
  const installed = LEGACY_HOOK_EVENTS.every((event) => hasCommand(hooks[event], command));
  const complete = HOOK_EVENTS.every((event) => hasCommand(hooks[event], command));
  return { installed, outdated: installed && !complete };
}

async function writeHookScript() {
  await withLock(async () => {
    const dir = guardPath(APP_HOOKS_DIR);
    const target = guardPath(CLAUDE_LIVE_SESSION_HOOK_FILE);
    await fs.mkdir(dir, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, CLAUDE_LIVE_SESSION_HOOK_SOURCE, "utf8");
    await fs.rename(temp, target);
  });
}

/**
 * hook 스크립트는 app 소유 파일이므로, 낡았으면 사용자 조작 없이 조용히 최신 소스로 갈아끼운다.
 * (settings.json은 사용자 설정이라 여기서 건드리지 않는다 — outdated로 알리고 동의를 받는다.)
 */
async function refreshHookScriptIfStale() {
  try {
    const target = guardPath(CLAUDE_LIVE_SESSION_HOOK_FILE);
    const current = await fs.readFile(target, "utf8").catch(() => null);
    if (current === null || current === CLAUDE_LIVE_SESSION_HOOK_SOURCE) return;
    await writeHookScript();
  } catch {
    // 갱신 실패가 상태 조회를 막지 않는다.
  }
}

export async function getClaudeLiveTrackingStatus(): Promise<ClaudeLiveTrackingStatus> {
  const command = hookCommand();
  try {
    const { content } = await readConfig(CONFIG_FILES.settings.path);
    const state = claudeLiveTrackingState(JSON.parse(content), command);
    if (state.installed) await refreshHookScriptIfStale();
    return { ...state, hookPath: CLAUDE_LIVE_SESSION_HOOK_FILE };
  } catch {
    return { installed: false, outdated: false, hookPath: CLAUDE_LIVE_SESSION_HOOK_FILE };
  }
}

export async function installClaudeLiveTracking(): Promise<ClaudeLiveTrackingStatus> {
  await writeHookScript();
  const config = await readConfig(CONFIG_FILES.settings.path);
  const next = mergeClaudeLiveTrackingHooks(JSON.parse(config.content));
  await safeWrite("settings", CONFIG_FILES.settings.path, `${JSON.stringify(next, null, 2)}\n`, config.sha256);
  return getClaudeLiveTrackingStatus();
}

export async function uninstallClaudeLiveTracking(): Promise<ClaudeLiveTrackingStatus> {
  const config = await readConfig(CONFIG_FILES.settings.path);
  const next = removeClaudeLiveTrackingHooks(JSON.parse(config.content));
  await safeWrite("settings", CONFIG_FILES.settings.path, `${JSON.stringify(next, null, 2)}\n`, config.sha256);
  return getClaudeLiveTrackingStatus();
}

/**
 * 오래된 레코드는 걷어낸다. 종료 표시가 없어도(강제 종료로 SessionEnd를 놓친 경우) 시작한 지
 * TTL이 지났으면 프로세스가 죽은 것으로 본다 — 살아있다면 UserPromptSubmit hook이 다시 기록한다.
 */
function isExpired(record: { startedAt: string; endedAt?: string }): boolean {
  const ts = Date.parse(record.endedAt ?? record.startedAt);
  return Number.isFinite(ts) && Date.now() - ts > LIVE_SESSION_RECORD_TTL_MS;
}

export async function readClaudeLiveSessionRecords(): Promise<ClaudeLiveSessionRecord[]> {
  const dir = guardPath(LIVE_SESSIONS_DIR);
  const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Array<import("node:fs").Dirent>);
  const records: ClaudeLiveSessionRecord[] = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    try {
      const filePath = guardPath(path.join(dir, file.name));
      const raw = await fs.readFile(filePath, "utf8");
      const value = JSON.parse(raw) as unknown;
      if (
        !isRecord(value) ||
        typeof value.sessionId !== "string" ||
        !value.sessionId ||
        typeof value.transcriptPath !== "string" ||
        !value.transcriptPath ||
        typeof value.processPid !== "number" ||
        !Number.isInteger(value.processPid) ||
        value.processPid <= 0 ||
        typeof value.processStartToken !== "string" ||
        !value.processStartToken ||
        typeof value.startedAt !== "string"
      ) {
        continue;
      }
      const record: ClaudeLiveSessionRecord = {
        sessionId: value.sessionId,
        cwd: typeof value.cwd === "string" ? value.cwd : null,
        transcriptPath: value.transcriptPath,
        model: typeof value.model === "string" ? value.model : null,
        processPid: value.processPid,
        processStartToken: value.processStartToken,
        startedAt: value.startedAt,
        endedAt: typeof value.endedAt === "string" ? value.endedAt : undefined,
      };
      if (isExpired(record)) {
        await fs.rm(filePath, { force: true });
        continue;
      }
      records.push(record);
    } catch {
      // 개별 hook 상태 손상은 다른 세션 감지를 막지 않는다.
    }
  }
  return records;
}

/** 설치된 hook은 stdout/stderr를 비워 Claude 대화 맥락과 종료 흐름에 영향을 주지 않는다. */
export const CLAUDE_LIVE_SESSION_HOOK_SOURCE = String.raw`#!/usr/bin/env node
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hookPath = fileURLToPath(import.meta.url);
const appStateDir = path.resolve(path.dirname(hookPath), "..");
const recordsDir = path.join(appStateDir, "live-sessions");

// 실행 파일 이름이 곧 CC인 경우(네이티브 런처).
const CLAUDE_EXEC = /^claude(\.exe)?$/i;
// npm 전역 설치처럼 node가 CC를 구동하는 경우. 경로 경계를 앵커해 "claude"가 끼어 있을 뿐인
// 커맨드라인(예: 이 hook 파일 경로, ~/.claude/... 안의 다른 스크립트)에 걸려들지 않게 한다.
const CLAUDE_CMD = /@anthropic-ai[\\/]claude-code|[\\/]claude(\.exe|\.js)?(?=$|["'\s])/i;

/**
 * 조상 프로세스 체인에서 이 세션을 돌리는 CC 프로세스를 고른다.
 * hook 자신을 실행한 셸은 커맨드라인에 hook 경로를 달고 있으므로 후보에서 먼저 배제한다
 * (이걸 빼먹으면 곧 죽을 셸의 PID를 기록하게 되어 "실행 중"이 영원히 안 잡힌다).
 */
export function pickClaudeAncestor(chain, selfPath) {
  const selfName = selfPath ? path.basename(selfPath) : "";
  for (const proc of chain || []) {
    if (!proc || !Number.isInteger(proc.pid) || !proc.startToken) continue;
    const command = typeof proc.command === "string" ? proc.command : "";
    if (selfName && command.includes(selfName)) continue;
    const name = typeof proc.name === "string" ? proc.name : "";
    if (CLAUDE_EXEC.test(name) || CLAUDE_CMD.test(command)) {
      return { pid: proc.pid, startToken: String(proc.startToken) };
    }
  }
  return null;
}

/**
 * PowerShell은 조상 체인을 덤프만 한다. 판정은 pickClaudeAncestor가 전담(테스트 가능하게).
 * 주의: powershell.exe -Command "<스크립트>" <인자> 는 $args를 채우지 않는다(인자가 스크립트 뒤에
 * 그대로 이어붙는다). 시작 PID는 정수이므로 스크립트 본문에 직접 박아 넣는다.
 */
function windowsChain() {
  try {
    if (!Number.isInteger(process.ppid) || process.ppid <= 0) return [];
    const script = "$current=[int]" + String(process.ppid) + ";$all=@{};Get-CimInstance Win32_Process|%{$all[[int]$_.ProcessId]=$_};$out=@();for($i=0;$i -lt 20 -and $current -gt 0;$i++){$p=$all[$current];if($null -eq $p){break};$out+=[pscustomobject]@{pid=[int]$p.ProcessId;parentPid=[int]$p.ParentProcessId;name=[string]$p.Name;command=[string]$p.CommandLine;startToken=[string]$p.CreationDate};$current=[int]$p.ParentProcessId};ConvertTo-Json -InputObject @($out) -Compress";
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true, timeout: 3000 }).trim();
    const parsed = out ? JSON.parse(out) : [];
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

function linuxProcessInfo(pid) {
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const command = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replace(/\0/g, " ").trim();
    return { name: stat.slice(open + 1, close), parentPid: Number(fields[1]), startToken: fields[19], command };
  } catch { return null; }
}

function linuxChain() {
  const chain = [];
  let current = process.ppid;
  for (let i = 0; i < 20 && current > 0; i += 1) {
    const info = linuxProcessInfo(current);
    if (!info) break;
    chain.push({ pid: current, parentPid: info.parentPid, name: info.name, command: info.command, startToken: info.startToken });
    current = info.parentPid;
  }
  return chain;
}

function findClaudeProcess() {
  if (process.platform === "win32") return pickClaudeAncestor(windowsChain(), hookPath);
  if (process.platform === "linux") return pickClaudeAncestor(linuxChain(), hookPath);
  return null;
}

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, "utf8")); } catch { return null; }
}

function recordPath(sessionId) {
  const name = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(recordsDir, name + ".json");
}

function readRecord(sessionId) {
  try { return JSON.parse(fs.readFileSync(recordPath(sessionId), "utf8")); } catch { return {}; }
}

function writeRecord(sessionId, record) {
  try {
    fs.mkdirSync(recordsDir, { recursive: true });
    const target = recordPath(sessionId);
    const temp = target + "." + process.pid + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(record), "utf8");
    fs.renameSync(temp, target);
  } catch { /* hook failure must stay silent */ }
}

/** 기록된 PID가 아직 살아있나. 프로세스 탐색(수백 ms)을 건너뛸지 판단하는 값싼 검사다. */
function recordStillLive(record) {
  if (!record || typeof record.processPid !== "number" || record.endedAt) return false;
  try {
    process.kill(record.processPid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM"; // 살아있지만 권한이 없는 경우
  }
}

/**
 * @param force SessionStart는 프로세스가 새로 떴으므로 항상 다시 탐색한다.
 *   UserPromptSubmit은 유효한 레코드가 이미 있으면 건너뛴다(매 프롬프트 지연 방지).
 */
function upsertRecord(input, sessionId, force) {
  const prev = readRecord(sessionId);
  if (!force && recordStillLive(prev)) return;
  const processInfo = findClaudeProcess();
  if (!processInfo || !Number.isInteger(processInfo.pid) || !processInfo.startToken) return;
  const now = new Date().toISOString();
  writeRecord(sessionId, {
    version: 1,
    sessionId,
    cwd: typeof input.cwd === "string" ? input.cwd : typeof prev.cwd === "string" ? prev.cwd : null,
    transcriptPath: typeof input.transcript_path === "string" ? input.transcript_path : typeof prev.transcriptPath === "string" ? prev.transcriptPath : "",
    model: typeof input.model === "string" ? input.model : typeof prev.model === "string" ? prev.model : null,
    processPid: processInfo.pid,
    processStartToken: String(processInfo.startToken),
    startedAt: !force && typeof prev.startedAt === "string" ? prev.startedAt : now,
  });
}

function main() {
  const input = readInput();
  if (!input || typeof input.session_id !== "string" || !input.session_id) return;
  const sessionId = input.session_id;
  const event = input.hook_event_name;
  if (event === "SessionEnd") {
    const prev = readRecord(sessionId);
    if (typeof prev.processPid !== "number") return; // 기록이 없으면 종료 표시만 남기지 않는다
    writeRecord(sessionId, { ...prev, sessionId, endedAt: new Date().toISOString() });
    return;
  }
  if (event === "SessionStart") upsertRecord(input, sessionId, true);
  else if (event === "UserPromptSubmit") upsertRecord(input, sessionId, false);
}

// 테스트가 pickClaudeAncestor만 import할 수 있도록, 직접 실행일 때만 hook 본체를 돌린다.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(hookPath)) main();
`;
