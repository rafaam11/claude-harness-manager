import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  APP_HOOKS_DIR,
  CLAUDE_LIVE_SESSION_HOOK_FILE,
  CONFIG_FILES,
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

/** 기존 사용자 hook을 건드리지 않고 app 소유 SessionStart/End hook만 병합한다. */
export function mergeClaudeLiveTrackingHooks(settings: unknown, command = hookCommand()): Record<string, unknown> {
  if (!isRecord(settings)) throw new Error("Claude settings.json 최상위는 객체여야 합니다.");
  const next = cloneObject(settings);
  const hooks = ensureHookRoot(next);
  for (const event of ["SessionStart", "SessionEnd"]) {
    const groups = hooks[event];
    if (groups !== undefined && !Array.isArray(groups)) {
      throw new Error(`${event} hook 설정 형식이 올바르지 않습니다.`);
    }
    if (hasCommand(groups, command)) continue;
    const nextGroups = Array.isArray(groups) ? [...groups] : [];
    nextGroups.push({ hooks: [{ type: "command", command, timeout: 3 }] });
    hooks[event] = nextGroups;
  }
  return next;
}

/** app 소유 command만 제거하고 다른 사용자 hook과 event 설정은 보존한다. */
export function removeClaudeLiveTrackingHooks(settings: unknown, command = hookCommand()): Record<string, unknown> {
  if (!isRecord(settings)) throw new Error("Claude settings.json 최상위는 객체여야 합니다.");
  const next = cloneObject(settings);
  if (!isRecord(next.hooks)) return next;
  for (const event of ["SessionStart", "SessionEnd"]) {
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

function hasLiveTrackingHooks(settings: unknown, command = hookCommand()): boolean {
  if (!isRecord(settings) || !isRecord(settings.hooks)) return false;
  return hasCommand(settings.hooks.SessionStart, command) && hasCommand(settings.hooks.SessionEnd, command);
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

export async function getClaudeLiveTrackingStatus(): Promise<ClaudeLiveTrackingStatus> {
  const command = hookCommand();
  try {
    const { content } = await readConfig(CONFIG_FILES.settings.path);
    return { installed: hasLiveTrackingHooks(JSON.parse(content), command), hookPath: CLAUDE_LIVE_SESSION_HOOK_FILE };
  } catch {
    return { installed: false, hookPath: CLAUDE_LIVE_SESSION_HOOK_FILE };
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

export async function readClaudeLiveSessionRecords(): Promise<ClaudeLiveSessionRecord[]> {
  const dir = guardPath(LIVE_SESSIONS_DIR);
  const files = await fs.readdir(dir, { withFileTypes: true }).catch(() => [] as Array<import("node:fs").Dirent>);
  const records: ClaudeLiveSessionRecord[] = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(guardPath(path.join(dir, file.name)), "utf8");
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
      records.push({
        sessionId: value.sessionId,
        cwd: typeof value.cwd === "string" ? value.cwd : null,
        transcriptPath: value.transcriptPath,
        model: typeof value.model === "string" ? value.model : null,
        processPid: value.processPid,
        processStartToken: value.processStartToken,
        startedAt: value.startedAt,
        endedAt: typeof value.endedAt === "string" ? value.endedAt : undefined,
      });
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

const hookDir = path.dirname(fileURLToPath(import.meta.url));
const appStateDir = path.resolve(hookDir, "..");
const recordsDir = path.join(appStateDir, "live-sessions");

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

function windowsClaudeProcess() {
  try {
    const script = "$current=[int]$args[0];$all=@{};Get-CimInstance Win32_Process|%{$all[[int]$_.ProcessId]=$_};$result=$null;for($i=0;$i -lt 20 -and $current -gt 0;$i++){$p=$all[$current];if($null -eq $p){break};$cmd=[string]$p.CommandLine;if($p.Name -match '(?i)^claude(?:\\.exe)?$' -or $cmd -match '(?i)(claude(?:\\.exe|\\.js)?|@anthropic-ai[\\/]claude-code)'){$result=[pscustomobject]@{pid=[int]$p.ProcessId;startToken=[string]$p.CreationDate};break};$current=[int]$p.ParentProcessId};if($null -ne $result){$result|ConvertTo-Json -Compress}";
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, String(process.ppid)], { encoding: "utf8", windowsHide: true, timeout: 1500 }).trim();
    return out ? JSON.parse(out) : null;
  } catch { return null; }
}

function linuxProcessInfo(pid) {
  try {
    const stat = fs.readFileSync("/proc/" + pid + "/stat", "utf8");
    const close = stat.lastIndexOf(")");
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const command = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8").replace(/\0/g, " ");
    return { parentPid: Number(fields[1]), startToken: fields[19], command };
  } catch { return null; }
}

function linuxClaudeProcess() {
  let current = process.ppid;
  for (let i = 0; i < 20 && current > 0; i += 1) {
    const info = linuxProcessInfo(current);
    if (!info) return null;
    if (/(?:^|[\\/])claude(?:\.js)?(?:\s|$)|@anthropic-ai[\\/]claude-code/i.test(info.command)) {
      return { pid: current, startToken: info.startToken };
    }
    current = info.parentPid;
  }
  return null;
}

function findClaudeProcess() {
  if (process.platform === "win32") return windowsClaudeProcess();
  if (process.platform === "linux") return linuxClaudeProcess();
  return null;
}

function main() {
  const input = readInput();
  if (!input || typeof input.session_id !== "string" || !input.session_id) return;
  const sessionId = input.session_id;
  if (input.hook_event_name === "SessionEnd") {
    writeRecord(sessionId, { ...readRecord(sessionId), sessionId, endedAt: new Date().toISOString() });
    return;
  }
  if (input.hook_event_name !== "SessionStart") return;
  const processInfo = findClaudeProcess();
  if (!processInfo || !Number.isInteger(processInfo.pid) || !processInfo.startToken) return;
  writeRecord(sessionId, {
    version: 1,
    sessionId,
    cwd: typeof input.cwd === "string" ? input.cwd : null,
    transcriptPath: typeof input.transcript_path === "string" ? input.transcript_path : "",
    model: typeof input.model === "string" ? input.model : null,
    processPid: processInfo.pid,
    processStartToken: String(processInfo.startToken),
    startedAt: new Date().toISOString(),
  });
}

main();
`;
