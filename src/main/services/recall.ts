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
import { getProjects, guessOriginalPath } from "./projects.js";
import { getPlans, type PlanInfo } from "./plans.js";
import { getSessionTodos, type SessionTodos } from "./tasks.js";
import { readBoard, type BoardStatus, type ProjectTrack } from "../lib/board.js";

const PROMPT_MAX = 2000; // 마지막 입력: 웬만하면 전부(아주 긴 경우만 컷)
const ASSISTANT_MAX = 800; // 마지막 응답: 적당히 넉넉하게

/** "마지막으로 뭐 했는지" — 한 세션 transcript에서 뽑은 회상 정보 */
export interface SessionRecall {
  sessionId: string | null;
  aiTitle: string | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  cwd: string | null;
  gitBranch: string | null;
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
}

export interface WorkspaceProject extends ProjectRecall {
  board: { status: BoardStatus | null; memo: string; nameOverride: string; tracks: ProjectTrack[] };
  plans: { filename: string; title: string; status: BoardStatus; archived: boolean }[];
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

// --- transcript 파싱 ---
interface RecallAcc {
  sessionId: string | null;
  aiTitle: string | null;
  lastPrompt: string | null;
  lastAssistantSnippet: string | null;
  cwd: string | null;
  gitBranch: string | null;
}

function firstNonEmptyText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  for (const c of content) {
    if (c && c.type === "text" && typeof c.text === "string" && c.text.trim()) return c.text;
  }
  return null;
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
    case "last-prompt":
      if (typeof o.lastPrompt === "string" && o.lastPrompt.trim()) acc.lastPrompt = o.lastPrompt;
      break;
    case "assistant": {
      const text = firstNonEmptyText(o.message?.content);
      if (text) acc.lastAssistantSnippet = text;
      if (typeof o.cwd === "string") acc.cwd = o.cwd;
      if (typeof o.gitBranch === "string") acc.gitBranch = o.gitBranch;
      if (typeof o.sessionId === "string") acc.sessionId = o.sessionId;
      break;
    }
    case "user":
      if (typeof o.cwd === "string") acc.cwd = o.cwd;
      if (typeof o.gitBranch === "string") acc.gitBranch = o.gitBranch;
      if (typeof o.sessionId === "string") acc.sessionId = o.sessionId;
      break;
  }
}

interface TranscriptRef {
  path: string;
  mtime: number;
  size: number;
}

async function findNewestTranscript(dir: string): Promise<TranscriptRef | null> {
  let best: TranscriptRef | null = null;
  async function walk(d: string) {
    for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".jsonl")) {
        const stat = await fs.stat(p).catch(() => null);
        if (stat && (!best || stat.mtimeMs > best.mtime)) {
          best = { path: p, mtime: stat.mtimeMs, size: stat.size };
        }
      }
    }
  }
  await walk(dir);
  return best;
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

export async function readNewestSessionRecall(projectDir: string): Promise<SessionRecall | null> {
  const newest = await findNewestTranscript(projectDir);
  if (!newest) return null;

  const acc: RecallAcc = {
    sessionId: path.basename(newest.path, ".jsonl"), // 파일명 uuid = sessionId
    aiTitle: null,
    lastPrompt: null,
    lastAssistantSnippet: null,
    cwd: null,
    gitBranch: null,
  };

  const { text, truncated } = await readTail(newest.path, newest.size);
  let lines = text.split("\n");
  if (truncated) lines = lines.slice(1); // 잘린 첫 줄 폐기
  for (const line of lines) applyLine(line, acc);

  // tail에 신호가 전무하면(드묾) 스트리밍 full-scan 1회 폴백
  if (
    truncated &&
    !acc.aiTitle &&
    !acc.lastPrompt &&
    !acc.lastAssistantSnippet &&
    newest.size <= RECALL_MAX_FULL_SCAN_BYTES
  ) {
    await fullScan(newest.path, acc);
  }

  return {
    sessionId: acc.sessionId,
    aiTitle: acc.aiTitle,
    lastPrompt: trunc(acc.lastPrompt, PROMPT_MAX),
    lastAssistantSnippet: trunc(acc.lastAssistantSnippet, ASSISTANT_MAX),
    cwd: acc.cwd,
    gitBranch: acc.gitBranch,
    transcriptPath: newest.path,
    transcriptMtime: newest.mtime,
    truncatedScan: truncated,
  };
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

// sessionId → projectId(=flatten 디렉토리명). transcript 파일명(uuid)이 sessionId라
// 각 프로젝트 디렉토리의 .jsonl 파일명만 훑으면 정확히 만들 수 있다(내용 안 읽음).
async function buildSessionToProjectIdUncached(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const entry of await fs.readdir(PROJECTS_DIR, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const root = entry.name;
    async function walk(d: string) {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name.endsWith(".jsonl")) m.set(path.basename(e.name, ".jsonl"), root);
      }
    }
    await walk(path.join(PROJECTS_DIR, root));
  }
  return m;
}
export const getSessionToProjectId = cached(WORKSPACE_CACHE_TTL_MS, buildSessionToProjectIdUncached);

// --- plan ↔ project 자동추정 ---
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
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

export async function getEnrichedPlans(includeArchived = false): Promise<EnrichedPlan[]> {
  const [plans, board, recalls, history, sessionToId] = await Promise.all([
    getPlans(includeArchived),
    readBoard(),
    getProjectRecalls(),
    getHistoryIndex(),
    getSessionToProjectId(),
  ]);
  const realToId = buildRealToIdMap(recalls);
  return plans.map((p) => {
    // 1순위: stamp-plan-session 훅이 새겨넣은 확정 세션ID(p.sessionId) → 그 세션의 프로젝트.
    // 2순위(마커 없거나 그 세션의 프로젝트를 못 찾을 때만): 가장 가까운 history 기록의
    // sessionId → 그 세션 transcript가 있는 프로젝트, 그마저 없으면 실제 경로 ↔ recall cwd 매칭.
    let guessedProjectId: string | null = p.sessionId
      ? sessionToId.get(p.sessionId) ?? null
      : null;
    if (!guessedProjectId) {
      const e = nearestEntry(p.mtime, history);
      if (e) {
        guessedProjectId =
          (e.sessionId ? sessionToId.get(e.sessionId) ?? null : null) ??
          realToId.get(normPath(e.project)) ??
          null;
      }
    }
    const b = board.plans[p.filename] ?? {};
    return {
      ...p,
      guessedProjectId,
      projectOverride: b.projectOverride ?? null,
      projectId: b.projectOverride ?? guessedProjectId,
      // 수동 지정 우선. 없으면 보관 계획은 "보관", 그 외는 "완료"로 추정
      // (대부분의 계획은 구현이 끝난 것이라, 진행중인 것만 수동으로 표시한다).
      status: b.status ?? (p.archived ? "보관" : "완료"),
      memo: b.memo ?? "",
    };
  });
}

export async function getWorkspaceProjects(): Promise<WorkspaceProject[]> {
  const [recalls, board, plans] = await Promise.all([
    getProjectRecalls(),
    readBoard(),
    getEnrichedPlans(false),
  ]);
  return recalls.map((r) => ({
    ...r,
    board: {
      status: board.projects[r.id]?.status ?? null,
      memo: board.projects[r.id]?.memo ?? "",
      nameOverride: board.projects[r.id]?.nameOverride ?? "",
      tracks: board.projects[r.id]?.tracks ?? [],
      hidden: board.projects[r.id]?.hidden ?? false,
      order: board.projects[r.id]?.order ?? null,
    },
    plans: plans
      .filter((p) => p.projectId === r.id)
      .map((p) => ({ filename: p.filename, title: p.title, status: p.status, archived: p.archived })),
  }));
}

export async function getTimeline(includeArchived = false): Promise<TimelineEvent[]> {
  const [recalls, plans, board] = await Promise.all([
    getProjectRecalls(),
    getEnrichedPlans(includeArchived),
    readBoard(),
  ]);
  // session/plan 이벤트가 같은 프로젝트면 동일한 realPath를 쓰도록 id→realPath 맵을 만든다.
  // (없으면 plan 이벤트가 realPath:null로 떨어져 프론트 shortName이 다른 이름을 내는 버그가 난다.)
  const idToRealPath = new Map(recalls.map((r) => [r.id, r.realPath]));
  const events: TimelineEvent[] = [];
  // 계획 ↔ 세션 부모 추정용: projectId별 세션 후보(사실상 0~1개라 선형 스캔으로 충분).
  const sessionsByProject = new Map<string, { sessionId: string; ts: number }[]>();
  for (const r of recalls) {
    if (r.recall) {
      const sid = r.recall.sessionId;
      // 자동추정 우선순위: 세션 직접 지정(override) → 프로젝트 상태 상속(자동) → "진행중"
      const status: BoardStatus =
        (sid ? board.sessions[sid]?.status : undefined) ??
        board.projects[r.id]?.status ??
        "진행중";
      events.push({
        ts: r.recall.transcriptMtime,
        kind: "session",
        projectId: r.id,
        realPath: r.realPath,
        title: r.recall.aiTitle ?? r.recall.lastPrompt ?? "(제목 없음)",
        sessionId: sid ?? undefined,
        status,
        lastPrompt: r.recall.lastPrompt,
        lastAssistantSnippet: r.recall.lastAssistantSnippet,
      });
      if (sid) {
        const arr = sessionsByProject.get(r.id) ?? [];
        arr.push({ sessionId: sid, ts: r.recall.transcriptMtime });
        sessionsByProject.set(r.id, arr);
      }
    }
  }
  for (const p of plans) {
    // 1순위: 훅이 새겨넣은 확정 세션ID. Timeline에 그 세션이 안 보이면 프론트에서 자동으로 flat 처리된다.
    // 2순위(마커 없을 때만): 같은 프로젝트의 세션 중 계획 mtime과 가장 가까운 것을 부모로 추정.
    let parentSessionId: string | undefined = p.sessionId ?? undefined;
    if (!parentSessionId) {
      const candidates = p.projectId ? sessionsByProject.get(p.projectId) : undefined;
      if (candidates) {
        let bestDelta = Infinity;
        for (const c of candidates) {
          const delta = Math.abs(c.ts - p.mtime);
          if (delta < bestDelta) {
            bestDelta = delta;
            parentSessionId = c.sessionId;
          }
        }
        if (bestDelta > PLAN_GUESS_WINDOW_MS) parentSessionId = undefined;
      }
    }
    events.push({
      ts: p.mtime,
      kind: "plan",
      projectId: p.projectId,
      realPath: p.projectId ? idToRealPath.get(p.projectId) ?? null : null,
      title: p.title,
      filename: p.filename,
      status: p.status,
      archived: p.archived,
      parentSessionId,
    });
  }
  return events.sort((a, b) => b.ts - a.ts);
}
