import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import readline from "node:readline";
import path from "node:path";
import {
  PROJECTS_DIR,
  HISTORY_FILE,
  RECALL_TAIL_BYTES,
  RECALL_MAX_FULL_SCAN_BYTES,
  WORKSPACE_CACHE_TTL_MS,
  PLAN_GUESS_WINDOW_MS,
  GLOSSARY_CORPUS_MAX_PROJECTS,
  GLOSSARY_PROMPTS_PER_PROJECT,
  GLOSSARY_CORPUS_MAX_TEXTS,
  GLOSSARY_PROMPT_MAX,
} from "../config.js";
import { guardPath } from "../lib/path-guard.js";
import { normalizePathKey } from "../lib/path-normalize.js";
import { getProjects, guessOriginalPath } from "./projects.js";
import { getPlans, type PlanInfo } from "./plans.js";
import { getSessionTodos, type SessionTodos } from "./tasks.js";
import { readBoard, type BoardStatus, type ProjectTrack } from "../lib/board.js";
import { computeRepoGroups, type WorktreeMember } from "./repo-group.js";
import { prefixEntityId, splitEntityId } from "../providers/registry.js";
import type { ProviderId, SessionKind } from "@shared/provider-types";

const PROMPT_MAX = 2000; // 마지막 입력: 웬만하면 전부(아주 긴 경우만 컷)
const ASSISTANT_MAX = 800; // 마지막 응답: 적당히 넉넉하게

/** "마지막으로 뭐 했는지" — 한 세션 transcript에서 뽑은 회상 정보 */
export interface SessionRecall {
  sessionId: string | null;
  sessionKind?: SessionKind;
  aiTitle: string | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  cwd: string | null;
  gitBranch: string | null;
  lastModel: string | null; // 마지막 assistant 메시지의 모델 ID(배지 표시용)
  transcriptPath: string;
  transcriptMtime: number;
  truncatedScan: boolean; // tail만 읽었는지
}

export interface ProjectRecall {
  id: string;
  realPath: string | null;
  gitBranch: string | null;
  lastActivity: number;
  staleDays: number;
  recall: SessionRecall | null;
  todos: SessionTodos | null;
}

export interface EnrichedPlan extends PlanInfo {
  guessedProjectId: string | null;
  projectOverride: string | null; // 사용자가 명시 지정한 값(없으면 null)
  projectId: string | null; // override ?? guessed
  status: BoardStatus;
  memo: string;
}

export interface TimelineEvent {
  ts: number;
  kind: "session" | "plan";
  projectId: string | null;
  realPath: string | null;
  title: string;
  filename?: string;
  sessionId?: string; // 세션 이벤트에만. 상태 드롭다운 저장 키.
  status: BoardStatus; // 드롭다운 현재값(자동추정 or 사용자 override)
  // 행 클릭 펼침용 내용. 세션은 스니펫(이미 recall 보유), 계획은 본문을 프론트에서 lazy-fetch.
  lastPrompt?: string | null; // 세션
  lastAssistantSnippet?: string | null; // 세션
  archived?: boolean; // 계획: 본문 fetch 시 archived 파라미터
  parentSessionId?: string; // 계획 이벤트에만. 시간 근접으로 추정한 부모 세션(있을 때만).
  lastModel?: string | null; // 세션 이벤트에만. 마지막 사용 모델 ID.
  worktreeName?: string | null; // 워크트리 세션이면 그 이름(대표 repo로 귀속된 뒤 어느 워크트리인지 표시).
  provider?: ProviderId;
}

export interface WorkspaceProject extends ProjectRecall {
  board: {
    status: BoardStatus | null;
    memo: string;
    nameOverride: string;
    tracks: ProjectTrack[];
    hidden: boolean;
    order: number | null;
  };
  // --- 워크트리 그룹핑(repo-group.ts) ---
  repoRoot: string | null; // 메인 워킹트리 루트(대표=repo 자신이면 realPath와 동일)
  isWorktree: boolean; // 대표가 (메인이 아닌) 워크트리인가(메인 세션이 아예 없을 때만)
  worktreeName: string | null;
  worktrees: WorktreeMember[]; // 이 repo에 접힌 linked 워크트리(최근활동순)
  memberIds: string[]; // 이 그룹에 속한 모든 projectId(board 상속·plan 필터에 사용)
}

interface HistoryEntry {
  timestamp: number;
  project: string; // 실제 절대경로
  sessionId?: string;
}

// --- TTL 캐시 (무거운 스캔을 반복 요청에서 보호) ---
function cached<T>(ttl: number, fn: () => Promise<T>): () => Promise<T> {
  let data: T | undefined;
  let at = 0;
  let inflight: Promise<T> | null = null;
  return () => {
    const now = Date.now();
    if (data !== undefined && now - at < ttl) return Promise.resolve(data);
    if (inflight) return inflight;
    inflight = fn().then(
      (d) => {
        data = d;
        at = Date.now();
        inflight = null;
        return d;
      },
      (e) => {
        inflight = null;
        throw e;
      },
    );
    return inflight;
  };
}

function toClaudeId(localId: string): string {
  return prefixEntityId("claude", localId);
}

function fromMaybePrefixedClaudeId(id: string): string {
  const split = splitEntityId(id);
  return split.provider === "claude" ? split.localId : id;
}

function normalizeOutgoingClaudeId(id: string | null | undefined): string | null | undefined {
  if (id == null) return id;
  const split = splitEntityId(id);
  return split.provider === "claude" ? toClaudeId(split.localId) : id;
}

function compatClaudeKeys(id: string): string[] {
  const split = splitEntityId(id);
  if (split.provider !== "claude") return [id];
  const prefixed = toClaudeId(split.localId);
  return prefixed === id ? [prefixed, split.localId] : [prefixed, id];
}

function getCompatEntry<T>(map: Record<string, T>, id: string): T | undefined {
  for (const key of compatClaudeKeys(id)) {
    if (key in map) return map[key];
  }
  return undefined;
}

// --- transcript 파싱 ---
interface RecallAcc {
  sessionId: string | null;
  sessionKind: SessionKind;
  aiTitle: string | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  cwd: string | null;
  gitBranch: string | null;
  lastModel: string | null;
}

function firstNonEmptyText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (c && c.type === "text" && typeof c.text === "string" && c.text.trim()) return c.text;
  }
  return null;
}

function isAgentTranscriptPath(filePath: string): boolean {
  return path.basename(filePath).startsWith("agent-");
}

function isInjectedClaudeText(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<") || t.startsWith("# AGENTS.md instructions") || t.startsWith("========= MEMORY_SUMMARY");
}

function preferRecallSessionKind(current: SessionKind, next: SessionKind): SessionKind {
  if (next === "main") return "main";
  if (current === "main") return current;
  if (next === "worker") return "worker";
  if (current === "worker") return current;
  if (next === "system") return "system";
  return current;
}

function sessionRecallRank(s: SessionRecall): number {
  if (s.sessionKind === "main") return 4;
  if (s.sessionKind === "unknown") return 3;
  if (s.sessionKind === "worker") return 2;
  if (s.sessionKind === "system") return 1;
  return 0;
}

function hasUserFacingRecallText(s: SessionRecall): boolean {
  return Boolean(s.aiTitle || s.lastPrompt || s.lastAssistantSnippet);
}

function betterUserFacingRecall(a: SessionRecall, b: SessionRecall): SessionRecall {
  const ar = sessionRecallRank(a);
  const br = sessionRecallRank(b);
  if (ar !== br) return br > ar ? b : a;
  const at = hasUserFacingRecallText(a);
  const bt = hasUserFacingRecallText(b);
  if (at !== bt) return bt ? b : a;
  return b.transcriptMtime >= a.transcriptMtime ? b : a;
}

function mergeSessionRecall(a: SessionRecall, b: SessionRecall): SessionRecall {
  const latest = b.transcriptMtime >= a.transcriptMtime ? b : a;
  const userFacing = betterUserFacingRecall(a, b);
  return {
    ...latest,
    sessionKind: preferRecallSessionKind(a.sessionKind ?? "unknown", b.sessionKind ?? "unknown"),
    aiTitle: userFacing.aiTitle ?? latest.aiTitle,
    lastPrompt: userFacing.lastPrompt ?? latest.lastPrompt,
    lastAssistantSnippet: userFacing.lastAssistantSnippet ?? latest.lastAssistantSnippet,
    cwd: latest.cwd ?? userFacing.cwd,
    gitBranch: latest.gitBranch ?? userFacing.gitBranch,
    lastModel: latest.lastModel ?? userFacing.lastModel,
    transcriptPath: userFacing.transcriptPath,
    transcriptMtime: Math.max(a.transcriptMtime, b.transcriptMtime),
    truncatedScan: a.truncatedScan || b.truncatedScan,
  };
}

export function dedupeSessionRecallsByConversation(sessions: SessionRecall[]): SessionRecall[] {
  const byKey = new Map<string, SessionRecall>();
  for (const session of sessions) {
    const key = session.sessionId ? `sid:${session.sessionId}` : `path:${session.transcriptPath}`;
    const prev = byKey.get(key);
    byKey.set(key, prev ? mergeSessionRecall(prev, session) : session);
  }
  return [...byKey.values()].sort((a, b) => b.transcriptMtime - a.transcriptMtime);
}

/** 한 줄(JSON)을 파싱해 acc의 "마지막 값"을 갱신. 순서대로 호출하면 최종값이 가장 마지막 등장값. */
function applyLine(line: string, acc: RecallAcc) {
  if (!line) return;
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  switch (o?.type) {
    case "ai-title":
      if (typeof o.aiTitle === "string" && o.aiTitle.trim()) acc.aiTitle = o.aiTitle;
      break;
    case "assistant": {
      const text = firstNonEmptyText(o.message?.content);
      if (text) acc.lastAssistantSnippet = text;
      if (typeof o.cwd === "string") acc.cwd = o.cwd;
      if (typeof o.gitBranch === "string") acc.gitBranch = o.gitBranch;
      if (typeof o.sessionId === "string") acc.sessionId = o.sessionId;
      if (typeof o.message?.model === "string") acc.lastModel = o.message.model;
      break;
    }
    case "user":
      if (typeof o.cwd === "string") acc.cwd = o.cwd;
      if (typeof o.gitBranch === "string") acc.gitBranch = o.gitBranch;
      if (typeof o.sessionId === "string") acc.sessionId = o.sessionId;
      // 실제 사용자가 타이핑한 프롬프트만(문자열 content). tool_result·interrupt 알림 등은
      // content가 배열이라 자연히 제외되고, 커맨드/시스템 wrapper(`<...>`)도 collectUserPrompts와
      // 동일한 기준으로 걸러낸다. ai-title/last-prompt 합성 라인이 없는(오래됐거나 훅 미발동)
      // 세션에서도 "(제목 없음)" 대신 실제 마지막 입력이 뜨도록 하는 fallback.
      if (!o.isMeta && typeof o.message?.content === "string") {
        const t = o.message.content.trim();
        if (t && !isInjectedClaudeText(t)) {
          acc.lastPrompt = t;
          if (acc.sessionKind !== "worker") acc.sessionKind = "main";
        } else if (t && acc.sessionKind === "unknown") {
          acc.sessionKind = "system";
        }
      }
      break;
  }
}

interface TranscriptRef {
  path: string;
  mtime: number;
  size: number;
}

async function findAllTranscripts(dir: string): Promise<TranscriptRef[]> {
  const results: TranscriptRef[] = [];
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".jsonl")) {
        const stat = await fs.stat(p).catch(() => null);
        if (stat) results.push({ path: p, mtime: stat.mtimeMs, size: stat.size });
      }
    }
  }
  await walk(dir);
  return results;
}

async function findNewestTranscript(dir: string): Promise<TranscriptRef | null> {
  const all = await findAllTranscripts(dir);
  return all.reduce<TranscriptRef | null>((best, r) => (!best || r.mtime > best.mtime ? r : best), null);
}

async function readTail(p: string, size: number): Promise<{ text: string; truncated: boolean }> {
  if (size <= RECALL_TAIL_BYTES) {
    return { text: await fs.readFile(p, "utf8"), truncated: false };
  }
  const fh = await fs.open(p, "r");
  try {
    const buf = Buffer.alloc(RECALL_TAIL_BYTES);
    const { bytesRead } = await fh.read(buf, 0, RECALL_TAIL_BYTES, size - RECALL_TAIL_BYTES);
    return { text: buf.toString("utf8", 0, bytesRead), truncated: true };
  } finally {
    await fh.close();
  }
}

async function fullScan(p: string, acc: RecallAcc) {
  const rl = readline.createInterface({
    input: createReadStream(p, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) applyLine(line, acc);
}

function trunc(s: string | null, max: number): string | null {
  if (!s) return s;
  const t = s.trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** 특정 transcript 파일 하나에서 회상 정보를 추출(tail-read). 파일명 uuid = sessionId. */
async function readSessionRecallFromFile(
  filePath: string,
  size: number,
  mtime: number,
): Promise<SessionRecall> {
  const acc: RecallAcc = {
    sessionId: path.basename(filePath, ".jsonl"), // 파일명 uuid = sessionId
    sessionKind: isAgentTranscriptPath(filePath) ? "worker" : "unknown",
    aiTitle: null,
    lastPrompt: null,
    lastAssistantSnippet: null,
    cwd: null,
    gitBranch: null,
    lastModel: null,
  };

  const { text, truncated } = await readTail(filePath, size);
  let lines = text.split("\n");
  if (truncated) lines = lines.slice(1); // 잘린 첫 줄 폐기
  for (const line of lines) applyLine(line, acc);

  // tail에 신호가 전무하면(드묾) 스트리밍 full-scan 1회 폴백
  if (
    truncated &&
    !acc.aiTitle &&
    !acc.lastPrompt &&
    !acc.lastAssistantSnippet &&
    size <= RECALL_MAX_FULL_SCAN_BYTES
  ) {
    await fullScan(filePath, acc);
  }

  return {
    sessionId: acc.sessionId,
    sessionKind: acc.sessionKind,
    aiTitle: acc.aiTitle,
    lastPrompt: trunc(acc.lastPrompt, PROMPT_MAX),
    lastAssistantSnippet: trunc(acc.lastAssistantSnippet, ASSISTANT_MAX),
    cwd: acc.cwd,
    gitBranch: acc.gitBranch,
    lastModel: acc.lastModel,
    transcriptPath: filePath,
    transcriptMtime: mtime,
    truncatedScan: truncated,
  };
}

export async function readNewestSessionRecall(projectDir: string): Promise<SessionRecall | null> {
  const all = await findAllTranscripts(projectDir);
  const nonAgent = all.filter((t) => !isAgentTranscriptPath(t.path));
  const newest = (nonAgent.length ? nonAgent : all).reduce<TranscriptRef | null>(
    (best, r) => (!best || r.mtime > best.mtime ? r : best),
    null,
  );
  if (!newest) return null;
  return readSessionRecallFromFile(newest.path, newest.size, newest.mtime);
}

// --- Glossary 추천 어휘용 프롬프트 corpus ---
// applyLine은 "마지막 1개"만 뽑으므로 추천 매칭엔 얕다. distinct user 프롬프트를 최신부터 모은다.
// type:"user" + 문자열 content만(배열은 tool 결과). 합성 last-prompt식 중복은 Set으로 제거.
function collectUserPrompts(lines: string[], limit: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i];
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o?.type !== "user" || o?.isMeta) continue;
    const c = o.message?.content;
    if (typeof c !== "string") continue; // 배열(tool 결과)·비문자열 제외
    const s = c.trim();
    if (!s || s.startsWith("<")) continue; // 빈 줄·커맨드/시스템 wrapper 제외
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s.length > GLOSSARY_PROMPT_MAX ? s.slice(0, GLOSSARY_PROMPT_MAX) : s);
  }
  return out;
}

// 최근 활동순 상위 프로젝트의 최신 transcript tail에서 프롬프트를 모은 corpus(외부 호출 0).
async function getPromptCorpusUncached(): Promise<string[]> {
  const projects = [...(await getProjects())]
    .sort((a, b) => b.lastActivity - a.lastActivity)
    .slice(0, GLOSSARY_CORPUS_MAX_PROJECTS);
  const texts: string[] = [];
  for (const proj of projects) {
    const newest = await findNewestTranscript(path.join(PROJECTS_DIR, proj.id));
    if (!newest) continue;
    const { text, truncated } = await readTail(newest.path, newest.size);
    let lines = text.split("\n");
    if (truncated) lines = lines.slice(1); // 잘린 첫 줄 폐기
    texts.push(...collectUserPrompts(lines, GLOSSARY_PROMPTS_PER_PROJECT));
    if (texts.length >= GLOSSARY_CORPUS_MAX_TEXTS) break;
  }
  return texts.slice(0, GLOSSARY_CORPUS_MAX_TEXTS);
}
export const getPromptCorpus = cached(WORKSPACE_CACHE_TTL_MS, getPromptCorpusUncached);

// --- history.jsonl 인덱스 ---
async function buildHistoryIndexUncached(): Promise<HistoryEntry[]> {
  const p = guardPath(HISTORY_FILE);
  if (!(await fs.access(p).then(() => true).catch(() => false))) return [];
  const out: HistoryEntry[] = [];
  const rl = readline.createInterface({
    input: createReadStream(p, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.timestamp === "number" && typeof o.project === "string") {
        out.push({
          timestamp: o.timestamp,
          project: o.project,
          sessionId: typeof o.sessionId === "string" ? o.sessionId : undefined,
        });
      }
    } catch {
      /* 깨진 줄 skip */
    }
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}
export const getHistoryIndex = cached(WORKSPACE_CACHE_TTL_MS, buildHistoryIndexUncached);

// --- 프로젝트 회상 묶음 ---
async function getProjectRecallsUncached(): Promise<ProjectRecall[]> {
  const projects = await getProjects();
  const out: ProjectRecall[] = [];
  for (const proj of projects) {
    const dir = path.join(PROJECTS_DIR, proj.id);
    const recall = await readNewestSessionRecall(dir);
    const realPath = recall?.cwd ?? guessOriginalPath(proj.id);
    const todos = recall?.sessionId ? await getSessionTodos(recall.sessionId) : null;
    out.push({
      id: proj.id,
      realPath,
      gitBranch: recall?.gitBranch ?? null,
      lastActivity: proj.lastActivity,
      staleDays: proj.staleDays,
      recall,
      todos,
    });
  }
  return out.sort((a, b) => b.lastActivity - a.lastActivity);
}
export const getProjectRecalls = cached(WORKSPACE_CACHE_TTL_MS, getProjectRecallsUncached);

// sessionId → { projectId(=flatten 디렉토리명), filePath }. transcript 파일명(uuid)이 sessionId라
// 각 프로젝트 디렉토리의 .jsonl 파일명만 훑으면 정확히 만들 수 있다(내용 안 읽음).
interface SessionPath {
  projectId: string;
  filePath: string;
}
async function buildSessionToPathMapUncached(): Promise<Map<string, SessionPath>> {
  const m = new Map<string, SessionPath>();
  for (const entry of await fs.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const root = entry.name;
    async function walk(d: string) {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".jsonl"))
          m.set(path.basename(e.name, ".jsonl"), { projectId: root, filePath: p });
      }
    }
    await walk(path.join(PROJECTS_DIR, root));
  }
  return m;
}
export const getSessionToPathMap = cached(WORKSPACE_CACHE_TTL_MS, buildSessionToPathMapUncached);

// --- plan ↔ project 자동추정 ---
function normPath(p: string): string {
  return normalizePathKey(p);
}

function buildRealToIdMap(recalls: ProjectRecall[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of recalls) {
    if (r.realPath) m.set(normPath(r.realPath), r.id);
  }
  return m;
}

/** mtime에 시간적으로 가장 가까운 history 기록(윈도우 안일 때만) */
function nearestEntry(mtime: number, idx: HistoryEntry[]): HistoryEntry | null {
  if (idx.length === 0) return null;
  let lo = 0;
  let hi = idx.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (idx[mid].timestamp < mtime) lo = mid + 1;
    else hi = mid;
  }
  let best: HistoryEntry | null = null;
  let bestDelta = Infinity;
  for (const j of [lo - 1, lo]) {
    if (j >= 0 && j < idx.length) {
      const d = Math.abs(idx[j].timestamp - mtime);
      if (d < bestDelta) {
        bestDelta = d;
        best = idx[j];
      }
    }
  }
  if (!best || bestDelta > PLAN_GUESS_WINDOW_MS) return null;
  return best;
}

/** 계획 하나를 세션 후보군에 매칭. 1순위: 마커(sessionId)가 실제 렌더된 세션이면 그것.
 * 2순위: PLAN_GUESS_WINDOW_MS 이내에서 mtime이 가장 가까운 세션. */
function matchPlanToSession(
  plan: { sessionId?: string | null; mtime: number },
  candidates: { sessionId: string; ts: number }[],
  renderedSessionIds: Set<string>,
): string | undefined {
  if (plan.sessionId && renderedSessionIds.has(plan.sessionId)) return plan.sessionId;
  let best: string | undefined;
  let bestDelta = Infinity;
  for (const c of candidates) {
    const delta = Math.abs(c.ts - plan.mtime);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = c.sessionId;
    }
  }
  return bestDelta <= PLAN_GUESS_WINDOW_MS ? best : undefined;
}

export async function getEnrichedPlans(includeArchived = false): Promise<EnrichedPlan[]> {
  const [plans, board, recalls, history, sessionToPath] = await Promise.all([
    getPlans(includeArchived),
    readBoard(),
    getProjectRecalls(),
    getHistoryIndex(),
    getSessionToPathMap(),
  ]);
  const realToId = buildRealToIdMap(recalls);
  return plans.map((p) => {
    // 1순위: stamp-plan-session 훅이 새겨넣은 확정 세션ID(p.sessionId) → 그 세션의 프로젝트.
    // 2순위(마커 없거나 그 세션의 프로젝트를 못 찾을 때만): 가장 가까운 history 기록의
    // sessionId → 그 세션 transcript가 있는 프로젝트, 그마저 없으면 실제 경로 ↔ recall cwd 매칭.
    let guessedProjectId: string | null = p.sessionId
      ? sessionToPath.get(p.sessionId)?.projectId ?? null
      : null;
    if (!guessedProjectId) {
      const e = nearestEntry(p.mtime, history);
      if (e) {
        guessedProjectId =
          (e.sessionId ? sessionToPath.get(e.sessionId)?.projectId ?? null : null) ??
          realToId.get(normPath(e.project)) ??
          null;
      }
    }
    const b = getCompatEntry(board.plans, p.filename) ?? {};
    const guessedProjectEntityId = normalizeOutgoingClaudeId(guessedProjectId) ?? null;
    const projectOverride = normalizeOutgoingClaudeId(b.projectOverride ?? null) ?? null;
    return {
      ...p,
      guessedProjectId: guessedProjectEntityId,
      projectOverride,
      projectId: projectOverride ?? guessedProjectEntityId,
      // 수동 지정 우선. 없으면 보관 계획은 "보관", 그 외는 "완료"로 추정
      // (대부분의 계획은 구현이 끝난 것이라, 진행중인 것만 수동으로 표시한다).
      status: b.status ?? (p.archived ? "보관" : "완료"),
      memo: b.memo ?? "",
    };
  });
}

export async function getWorkspaceProjects(): Promise<WorkspaceProject[]> {
  const [recalls, board] = await Promise.all([getProjectRecalls(), readBoard()]);
  // 워크트리·하위폴더를 같은 git 저장소(공유 .git)로 접어 대표 카드 하나로 만든다.
  const groups = await computeRepoGroups(recalls);

  // board는 대표(canonicalId)로 읽되, 대표에 값이 없고 멤버(워크트리) id에 있으면 상속한다 —
  // 예전에 워크트리 id로 저장해둔 상태/메모/이름/트랙을 잃지 않도록. hidden/order는 목록 동작이라
  // 대표 전용. 앞으로의 쓰기는 canonicalId로만 간다.
  const readField = <T>(
    ids: string[],
    sel: (e: NonNullable<(typeof board)["projects"][string]>) => T | null | undefined,
  ): T | null => {
    for (const id of ids) {
      for (const key of compatClaudeKeys(id)) {
        const e = board.projects[key];
        if (!e) continue;
        const v = sel(e);
        if (v == null) continue;
        if (typeof v === "string" && v === "") continue;
        if (Array.isArray(v) && v.length === 0) continue;
        return v as T;
      }
    }
    return null;
  };

  return groups.map((g) => {
    const ids = [g.canonicalId, ...g.memberIds.filter((id) => id !== g.canonicalId)];
    const canonicalId = toClaudeId(g.canonicalId);
    const memberIds = g.memberIds.map(toClaudeId);
    const canon = getCompatEntry(board.projects, g.canonicalId);
    return {
      ...g.representative,
      id: canonicalId,
      repoRoot: g.repoRoot,
      isWorktree: g.isWorktree,
      worktreeName: g.worktreeName,
      worktrees: g.worktrees.map((w) => ({ ...w, projectId: toClaudeId(w.projectId) })),
      memberIds,
      board: {
        status: readField(ids, (e) => e.status),
        memo: readField<string>(ids, (e) => e.memo) ?? "",
        nameOverride: readField<string>(ids, (e) => e.nameOverride) ?? "",
        tracks: readField<ProjectTrack[]>(ids, (e) => e.tracks) ?? [],
        hidden: canon?.hidden ?? false,
        order: canon?.order ?? null,
      },
    };
  });
}

/**
 * 특정 프로젝트(대표 repo)에 속한 모든 세션 기록. getProjectRecalls/getWorkspaceProjects는
 * 프로젝트 디렉토리당 최신 transcript 하나만 읽지만, 여기서는 그룹의 memberIds(워크트리·하위폴더
 * 포함) 전체 디렉토리에서 모든 transcript를 열거해 실제 세션 히스토리를 통째로 보여준다.
 */
export async function getProjectSessions(projectId: string): Promise<SessionRecall[]> {
  const localProjectId = fromMaybePrefixedClaudeId(projectId);
  const recalls = await getProjectRecalls();
  const groups = await computeRepoGroups(recalls);
  const group = groups.find(
    (g) => g.canonicalId === localProjectId || g.memberIds.includes(localProjectId),
  );
  const memberIds = group ? group.memberIds : [localProjectId];

  const lists = await Promise.all(
    memberIds.map(async (id) => {
      const transcripts = await findAllTranscripts(path.join(PROJECTS_DIR, id));
      return Promise.all(
        transcripts.map((t) => readSessionRecallFromFile(t.path, t.size, t.mtime)),
      );
    }),
  );
  return dedupeSessionRecallsByConversation(lists.flat());
}

export async function getTimeline(includeArchived = false): Promise<TimelineEvent[]> {
  const [recalls, plans, board, sessionToPath] = await Promise.all([
    getProjectRecalls(),
    getEnrichedPlans(includeArchived),
    readBoard(),
    getSessionToPathMap(),
  ]);
  // session/plan 이벤트가 같은 프로젝트면 동일한 realPath를 쓰도록 id→realPath 맵을 만든다.
  // (없으면 plan 이벤트가 realPath:null로 떨어져 프론트 shortName이 다른 이름을 내는 버그가 난다.)
  const idToRealPath = new Map(recalls.map((r) => [r.id, r.realPath]));

  // 워크트리·하위폴더를 대표 repo로 귀속하는 맵. 이벤트를 대표 id/repoRoot로 접어 탭이 repo당 하나가 되게 한다.
  const groups = await computeRepoGroups(recalls);
  const idToCanon = new Map<string, string>();
  const canonToRepoRoot = new Map<string, string | null>();
  const idToWorktreeName = new Map<string, string>();
  for (const g of groups) {
    canonToRepoRoot.set(g.canonicalId, g.repoRoot);
    for (const id of g.memberIds) idToCanon.set(id, g.canonicalId);
    for (const w of g.worktrees) idToWorktreeName.set(w.projectId, w.name);
    if (g.isWorktree && g.worktreeName) idToWorktreeName.set(g.canonicalId, g.worktreeName);
  }

  // 계획 마커가 가리키는 세션이 프로젝트 "최신" 세션이 아니면 SESS 행이 없어 계획이
  // flat으로 남는다 — 마커 세션의 transcript를 추가로 tail-read해 SESS 행으로 포함시킨다.
  // (읽기 개수는 마커 계획 수에 비례하므로 가볍고, transcript 부재(agent-* 등)는 skip.)
  const loadedSessionIds = new Set<string>();
  for (const r of recalls) if (r.recall?.sessionId) loadedSessionIds.add(r.recall.sessionId);
  const missingSessionIds = [
    ...new Set(plans.map((p) => p.sessionId).filter((s): s is string => !!s)),
  ].filter((sid) => !loadedSessionIds.has(sid) && sessionToPath.has(sid));
  const extraRecalls = (
    await Promise.all(
      missingSessionIds.map(async (sid) => {
        const sp = sessionToPath.get(sid)!;
        try {
          const stat = await fs.stat(sp.filePath);
          const recall = await readSessionRecallFromFile(sp.filePath, stat.size, stat.mtimeMs);
          return { projectId: sp.projectId, recall };
        } catch {
          return null; // 읽기 실패 — 계획은 기존 fallback(최근접 세션 or flat)으로
        }
      }),
    )
  ).filter((x): x is { projectId: string; recall: SessionRecall } => x !== null);

  const events: TimelineEvent[] = [];
  // 계획 ↔ 세션 부모 추정용: projectId별 세션 후보(프로젝트당 소수라 선형 스캔으로 충분).
  const sessionsByProject = new Map<string, { sessionId: string; ts: number }[]>();
  const pushSession = (projectId: string, realPath: string | null, recall: SessionRecall) => {
    const sid = recall.sessionId;
    // 자동추정 우선순위: 세션 직접 지정(override) → 프로젝트 상태 상속(자동) → "진행중"
    const status: BoardStatus =
      (sid ? getCompatEntry(board.sessions, sid)?.status : undefined) ??
      getCompatEntry(board.projects, projectId)?.status ??
      "진행중";
    events.push({
      ts: recall.transcriptMtime,
      kind: "session",
      projectId,
      realPath,
      title: recall.aiTitle ?? recall.lastPrompt ?? "(제목 없음)",
      sessionId: sid ?? undefined,
      status,
      lastPrompt: recall.lastPrompt,
      lastAssistantSnippet: recall.lastAssistantSnippet,
      lastModel: recall.lastModel,
    });
    if (sid) {
      const arr = sessionsByProject.get(projectId) ?? [];
      arr.push({ sessionId: sid, ts: recall.transcriptMtime });
      sessionsByProject.set(projectId, arr);
    }
  };
  for (const r of recalls) if (r.recall) pushSession(r.id, r.realPath, r.recall);
  for (const er of extraRecalls)
    pushSession(er.projectId, idToRealPath.get(er.projectId) ?? null, er.recall);

  // 실제 SESS 행이 된 세션 집합 — 마커가 있어도 행이 없으면(transcript 부재) 2순위로 넘긴다.
  const renderedSessionIds = new Set<string>();
  for (const e of events) if (e.sessionId) renderedSessionIds.add(e.sessionId);

  for (const p of plans) {
    const localPlanProjectId = p.projectId ? fromMaybePrefixedClaudeId(p.projectId) : null;
    // 1순위: 훅이 새겨넣은 확정 세션ID(그 SESS 행이 실제로 존재할 때만).
    // 2순위: 같은 프로젝트의 세션 중 계획 mtime과 가장 가까운 것을 부모로 추정.
    const candidates = localPlanProjectId ? sessionsByProject.get(localPlanProjectId) ?? [] : [];
    const parentSessionId = matchPlanToSession(p, candidates, renderedSessionIds);
    events.push({
      ts: p.mtime,
      kind: "plan",
      projectId: localPlanProjectId,
      realPath: localPlanProjectId ? idToRealPath.get(localPlanProjectId) ?? null : null,
      title: p.title,
      filename: p.filename,
      status: p.status,
      archived: p.archived,
      parentSessionId,
    });
  }

  // 각 이벤트를 대표 repo로 귀속: projectId→canonical, realPath→repoRoot, 어느 워크트리인지 태그.
  const remapped = events.map((e) => {
    if (e.projectId == null) return e;
    const canon = idToCanon.get(e.projectId) ?? e.projectId;
    return {
      ...e,
      projectId: canon,
      realPath: canonToRepoRoot.get(canon) ?? e.realPath,
      worktreeName: idToWorktreeName.get(e.projectId) ?? null,
    };
  });
  return remapped
    .map((e) => ({
      ...e,
      projectId: (normalizeOutgoingClaudeId(e.projectId) ?? null) as string | null,
      sessionId: normalizeOutgoingClaudeId(e.sessionId) as string | undefined,
      parentSessionId: normalizeOutgoingClaudeId(e.parentSessionId) as string | undefined,
    }))
    .sort((a, b) => b.ts - a.ts);
}
