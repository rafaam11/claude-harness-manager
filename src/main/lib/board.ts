import fs from "node:fs/promises";
import path from "node:path";
import { APP_BACKUP_DIR, BACKUP_KEEP, BOARD_FILE, BOARD_FILE_V2 } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";

/**
 * Workspace 대시보드의 수동 레이어 저장소.
 * 사용자 환경 파일이 아닌 **앱 소유** board.json 한 파일만 쓴다.
 * 쓰기는 withLock 직렬화 + atomic temp/rename + .bak 백업(safe-write와 동일 mechanics).
 * board.json은 CC가 외부에서 재작성하지 않으므로 baseHash 낙관적 동시성은 쓰지 않고,
 * 락 안에서 read-modify-write 필드 머지로 lost-update만 막는다.
 */

export type BoardStatus = "진행중" | "보류" | "완료" | "보관";
const STATUSES: readonly string[] = ["진행중", "보류", "완료", "보관"];

export interface PlanBoardEntry {
  status?: BoardStatus;
  memo?: string;
  projectOverride?: string;
}
/** 프로젝트 트랙(작업 갈래) 안의 할 일 한 줄. CC 세션과 무관한 앱 소유 데이터. */
export interface ProjectTodo {
  id: string;
  text: string;
  done: boolean;
}
/** 한 프로젝트의 작업 갈래. 여러 트랙이 각자 체크리스트(items)를 가진다. */
export interface ProjectTrack {
  id: string;
  title: string;
  items: ProjectTodo[];
}
export interface ProjectBoardEntry {
  status?: BoardStatus;
  memo?: string;
  nameOverride?: string;
  tracks?: ProjectTrack[];
  /** Git 작업 대상 저장소의 실제 경로(자동 해석이 부정확할 때 사용자가 폴더 선택으로 교정). */
  repoPath?: string;
  /** Workspace 목록에서 숨김 처리(하단 접이식 섹션으로 이동). */
  hidden?: boolean;
  /** 수동 정렬 순번(작을수록 위). 미설정이면 자동 정렬 fallback. */
  order?: number;
}
/** Timeline 세션 이벤트의 수동 레이어. sessionId(uuid)를 키로 한 flat 맵에 담는다. */
export interface SessionBoardEntry {
  status?: BoardStatus;
  memo?: string;
  /** 타임라인과 Workspace 상단에 유지할 직접 대화 세션인지. */
  pinned?: boolean;
}
export interface BoardData {
  schemaVersion: 2;
  migratedFrom?: string;
  migratedAt?: string;
  plans: Record<string, PlanBoardEntry>;
  projects: Record<string, ProjectBoardEntry>;
  sessions: Record<string, SessionBoardEntry>;
}

function emptyBoard(): BoardData {
  return { schemaVersion: 2, plans: {}, projects: {}, sessions: {} };
}

function asStatus(v: unknown): BoardStatus | undefined {
  return typeof v === "string" && STATUSES.includes(v) ? (v as BoardStatus) : undefined;
}

/** 신뢰할 수 없는 tracks 입력을 화이트리스트로 정제 — id 없는 트랙/항목, 형식 불량은 버린다. */
function sanitizeTracks(raw: unknown): ProjectTrack[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectTrack[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const tr = t as Record<string, unknown>;
    if (typeof tr.id !== "string" || !tr.id) continue;
    if (typeof tr.title !== "string") continue;
    const items: ProjectTodo[] = [];
    if (Array.isArray(tr.items)) {
      for (const it of tr.items) {
        if (!it || typeof it !== "object") continue;
        const i = it as Record<string, unknown>;
        if (typeof i.id !== "string" || !i.id) continue;
        if (typeof i.text !== "string") continue;
        items.push({ id: i.id, text: i.text, done: i.done === true });
      }
    }
    out.push({ id: tr.id, title: tr.title, items });
  }
  return out;
}

function prefixLegacyKey(key: string): string {
  return key.startsWith("claude:") || key.startsWith("codex:") ? key : `claude:${key}`;
}

type ReadBoardFileResult =
  | { kind: "missing" }
  | { kind: "corrupt" }
  | { kind: "ok"; board: BoardData };

/** 신뢰할 수 없는 입력(파일 내용/요청)을 board 스키마로 정제 — 화이트리스트 밖 값은 버린다. */
function sanitize(parsed: unknown): BoardData {
  const board = emptyBoard();
  if (!parsed || typeof parsed !== "object") return board;
  const p = parsed as Record<string, unknown>;
  if (p.schemaVersion === 2) {
    if (typeof p.migratedFrom === "string" && p.migratedFrom) board.migratedFrom = p.migratedFrom;
    if (typeof p.migratedAt === "string" && p.migratedAt) board.migratedAt = p.migratedAt;
  }

  // plan/project 공용 정제. kind에 따라 plan 전용(projectOverride) / project 전용(nameOverride·tracks)을 분기.
  const toEntry = (raw: unknown, kind: "plan" | "project"): PlanBoardEntry & ProjectBoardEntry => {
    const e: PlanBoardEntry & ProjectBoardEntry = {};
    if (!raw || typeof raw !== "object") return e;
    const r = raw as Record<string, unknown>;
    const st = asStatus(r.status);
    if (st) e.status = st;
    if (typeof r.memo === "string" && r.memo) e.memo = r.memo;
    if (kind === "plan" && typeof r.projectOverride === "string" && r.projectOverride) {
      e.projectOverride = r.projectOverride;
    }
    if (kind === "project") {
      if (typeof r.nameOverride === "string" && r.nameOverride) e.nameOverride = r.nameOverride;
      if (typeof r.repoPath === "string" && r.repoPath) e.repoPath = r.repoPath;
      if (r.hidden === true) e.hidden = true;
      if (typeof r.order === "number" && Number.isFinite(r.order)) e.order = r.order;
      const tracks = sanitizeTracks(r.tracks);
      if (tracks.length) e.tracks = tracks;
    }
    return e;
  };

  if (p.plans && typeof p.plans === "object") {
    for (const [k, v] of Object.entries(p.plans as Record<string, unknown>)) {
      board.plans[k] = toEntry(v, "plan");
    }
  }
  if (p.projects && typeof p.projects === "object") {
    for (const [k, v] of Object.entries(p.projects as Record<string, unknown>)) {
      board.projects[k] = toEntry(v, "project");
    }
  }
  // 세션은 status/memo/pinned만 살린다(plan/project와 키가 달라 별도 정제).
  if (p.sessions && typeof p.sessions === "object") {
    for (const [k, v] of Object.entries(p.sessions as Record<string, unknown>)) {
      const r = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      const e: SessionBoardEntry = {};
      const st = asStatus(r.status);
      if (st) e.status = st;
      if (typeof r.memo === "string" && r.memo) e.memo = r.memo;
      if (r.pinned === true) e.pinned = true;
      board.sessions[k] = e;
    }
  }
  return board;
}

export function migrateBoard(parsed: unknown): BoardData {
  const sanitized = sanitize(parsed);
  const raw = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (raw.schemaVersion === 2) return sanitized;

  const migrated = emptyBoard();
  for (const [k, v] of Object.entries(sanitized.projects)) migrated.projects[prefixLegacyKey(k)] = v;
  for (const [k, v] of Object.entries(sanitized.plans)) migrated.plans[prefixLegacyKey(k)] = v;
  for (const [k, v] of Object.entries(sanitized.sessions)) migrated.sessions[prefixLegacyKey(k)] = v;
  migrated.migratedFrom = "legacy-claude-board";
  migrated.migratedAt = new Date().toISOString();
  return migrated;
}

async function readBoardFile(
  filePath: string,
  options: { quarantineCorrupt?: boolean } = {},
): Promise<ReadBoardFileResult> {
  const quarantineCorrupt = options.quarantineCorrupt !== false;
  const p = guardPath(filePath);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    throw e;
  }
  try {
    return { kind: "ok", board: migrateBoard(JSON.parse(raw)) };
  } catch {
    if (quarantineCorrupt) {
      // v2 손상본은 옆에 보관하고 기본값으로 생존(페이지가 죽지 않게).
      // 레거시 migration source는 사용자의 원본이므로 read 경로에서 변경하지 않는다.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.rename(p, guardPath(`${filePath}.corrupt.${stamp}`)).catch(() => {});
    }
    return { kind: "corrupt" };
  }
}

export async function readBoard(): Promise<BoardData> {
  const nextBoard = await readBoardFile(BOARD_FILE_V2);
  if (nextBoard.kind === "ok") return nextBoard.board;
  if (nextBoard.kind === "corrupt") return emptyBoard();

  const legacyBoard = await readBoardFile(BOARD_FILE, { quarantineCorrupt: false });
  if (legacyBoard.kind === "ok") return legacyBoard.board;

  return emptyBoard();
}

async function rotateBackups(prefix: string) {
  const entries = await fs.readdir(APP_BACKUP_DIR).catch(() => [] as string[]);
  const mine = entries.filter((e) => e.startsWith(prefix)).sort();
  while (mine.length > BACKUP_KEEP) {
    const oldest = mine.shift()!;
    await fs.rm(path.join(APP_BACKUP_DIR, oldest), { force: true });
  }
}

async function writeBoardAtomic(data: BoardData) {
  const p = guardPath(BOARD_FILE_V2);
  await fs.mkdir(path.dirname(p), { recursive: true });

  // 현재본이 있으면 .bak 백업(로테이션) 후 덮어쓴다
  const current = await fs.readFile(p).catch(() => null);
  if (current) {
    await fs.mkdir(APP_BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(path.join(APP_BACKUP_DIR, `${path.basename(p)}.${stamp}.bak`), current);
    await rotateBackups(path.basename(p) + ".");
  }

  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tempPath, p);
}

/** 빈 엔트리({})는 키 자체를 제거해 board를 깔끔하게 유지 */
function pruneIfEmpty(map: Record<string, object>, key: string) {
  if (map[key] && Object.keys(map[key]).length === 0) delete map[key];
}

function unprefixedPlanKey(key: string): string | null {
  if (key.startsWith("claude:")) return key.slice("claude:".length);
  if (key.startsWith("codex:")) return key.slice("codex:".length);
  return null;
}

function planWriteKeys(filename: string): {
  target: string;
  compatible: string[];
} {
  const raw = unprefixedPlanKey(filename);
  if (raw !== null) {
    const compatible = [raw, filename].filter((key, index, keys) => keys.indexOf(key) === index);
    return { target: filename, compatible };
  }

  const claudeKey = `claude:${filename}`;
  return { target: claudeKey, compatible: [filename, claudeKey] };
}

export async function setPlanField(
  filename: string,
  patch: { status?: string; memo?: string; projectOverride?: string | null },
): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    const { target, compatible } = planWriteKeys(filename);
    const entry: PlanBoardEntry = {};
    for (const key of compatible) Object.assign(entry, board.plans[key] ?? {});
    if (patch.status !== undefined) {
      const st = asStatus(patch.status);
      if (st) entry.status = st;
    }
    if (patch.memo !== undefined) {
      if (patch.memo) entry.memo = patch.memo;
      else delete entry.memo;
    }
    if (patch.projectOverride !== undefined) {
      // null/"" 이면 override 해제(자동추정으로 복귀)
      if (patch.projectOverride) entry.projectOverride = patch.projectOverride;
      else delete entry.projectOverride;
    }
    for (const key of compatible) {
      if (key !== target) delete board.plans[key];
    }
    board.plans[target] = entry;
    pruneIfEmpty(board.plans, target);
    await writeBoardAtomic(board);
    return board;
  });
}

export interface ProjectBoardPatch {
  status?: string;
  memo?: string;
  nameOverride?: string | null;
  tracks?: ProjectTrack[];
  repoPath?: string | null;
  hidden?: boolean;
  order?: number | null;
}

function applyProjectPatch(entry: ProjectBoardEntry, patch: ProjectBoardPatch): ProjectBoardEntry {
  const next = { ...entry };
  if (patch.status !== undefined) {
    const st = asStatus(patch.status);
    if (st) next.status = st;
  }
  if (patch.memo !== undefined) {
    if (patch.memo) next.memo = patch.memo;
    else delete next.memo;
  }
  if (patch.nameOverride !== undefined) {
    // null/"" 이면 override 해제(기본 이름으로 복귀)
    if (patch.nameOverride) next.nameOverride = patch.nameOverride;
    else delete next.nameOverride;
  }
  if (patch.repoPath !== undefined) {
    // null/"" 이면 override 해제(자동 해석으로 복귀)
    if (patch.repoPath) next.repoPath = patch.repoPath;
    else delete next.repoPath;
  }
  if (patch.hidden !== undefined) {
    // false면 키 제거(기본=표시)
    if (patch.hidden) next.hidden = true;
    else delete next.hidden;
  }
  if (patch.order !== undefined) {
    // null/비number면 키 제거(자동 정렬로 복귀)
    if (typeof patch.order === "number" && Number.isFinite(patch.order)) next.order = patch.order;
    else delete next.order;
  }
  if (patch.tracks !== undefined) {
    // 전체 교체. 빈 배열이면 키 제거(빈 엔트리는 pruneIfEmpty가 정리)
    const tracks = sanitizeTracks(patch.tracks);
    if (tracks.length) next.tracks = tracks;
    else delete next.tracks;
  }
  return next;
}

export async function setProjectField(
  id: string,
  patch: ProjectBoardPatch,
): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    const entry = applyProjectPatch(board.projects[id] ?? {}, patch);
    board.projects[id] = entry;
    pruneIfEmpty(board.projects, id);
    await writeBoardAtomic(board);
    return board;
  });
}

/** 교차-provider 병합 카드의 모든 멤버에 같은 patch를 한 번의 atomic write로 반영한다. */
export async function setProjectsField(
  ids: string[],
  patch: ProjectBoardPatch,
): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    for (const id of [...new Set(ids.filter(Boolean))]) {
      board.projects[id] = applyProjectPatch(board.projects[id] ?? {}, patch);
      pruneIfEmpty(board.projects, id);
    }
    await writeBoardAtomic(board);
    return board;
  });
}

/**
 * 여러 프로젝트의 수동 정렬 순번을 한 번의 atomic write로 일괄 저장.
 * 화살표 첫 이동 시 전체에 순번을 시드해야 하므로 개별 setProjectField를 N번 돌리는 대신
 * 단일 write로 처리해 .bak 백업 링 소진을 막는다.
 */
export async function setProjectsOrder(orders: Record<string, number>): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    for (const [id, n] of Object.entries(orders)) {
      if (typeof n !== "number" || !Number.isFinite(n)) continue;
      const entry: ProjectBoardEntry = { ...board.projects[id] };
      entry.order = n;
      board.projects[id] = entry;
    }
    await writeBoardAtomic(board);
    return board;
  });
}

/**
 * 여러 프로젝트에 같은 hidden/status를 한 번의 atomic write로 일괄 적용.
 * 교차-provider 병합 카드(예: claude:X + codex:X)의 숨김/보관을 모든 멤버에 동시에 반영해야
 * 대표 status/hidden(가장 활성·모두 숨김 규칙)이 의도대로 바뀐다. .bak 링 소진을 막기 위해
 * 개별 setProjectField를 N번 돌리지 않고 단일 write로 처리한다.
 */
export async function setProjectsVisibility(
  ids: string[],
  patch: { hidden?: boolean; status?: string },
): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    const st = patch.status !== undefined ? asStatus(patch.status) : undefined;
    for (const id of ids) {
      const entry: ProjectBoardEntry = { ...board.projects[id] };
      if (patch.hidden !== undefined) {
        if (patch.hidden) entry.hidden = true;
        else delete entry.hidden;
      }
      if (st) entry.status = st;
      board.projects[id] = entry;
      pruneIfEmpty(board.projects, id);
    }
    await writeBoardAtomic(board);
    return board;
  });
}

function sessionWriteKeys(sessionId: string): { target: string; compatible: string[] } {
  if (sessionId.startsWith("claude:")) {
    const localId = sessionId.slice("claude:".length);
    return { target: sessionId, compatible: [sessionId, localId] };
  }
  if (sessionId.startsWith("codex:")) return { target: sessionId, compatible: [sessionId] };
  const target = `claude:${sessionId}`;
  return { target, compatible: [target, sessionId] };
}

export interface SessionBoardPatch {
  status?: string;
  memo?: string;
  pinned?: boolean;
}

export async function setSessionField(sessionId: string, patch: SessionBoardPatch): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    const { target, compatible } = sessionWriteKeys(sessionId);
    const entry: SessionBoardEntry = {};
    for (const key of compatible) Object.assign(entry, board.sessions[key] ?? {});
    if (patch.status !== undefined) {
      const st = asStatus(patch.status);
      if (st) entry.status = st;
    }
    if (patch.memo !== undefined) {
      if (patch.memo) entry.memo = patch.memo;
      else delete entry.memo;
    }
    if (patch.pinned !== undefined) {
      if (patch.pinned) entry.pinned = true;
      else delete entry.pinned;
    }
    for (const key of compatible) {
      if (key !== target) delete board.sessions[key];
    }
    board.sessions[target] = entry;
    pruneIfEmpty(board.sessions, target);
    await writeBoardAtomic(board);
    return board;
  });
}
