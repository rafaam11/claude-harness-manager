import fs from "node:fs/promises";
import path from "node:path";
import { BOARD_FILE, BACKUP_DIR, BACKUP_KEEP } from "../config.js";
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
export interface ProjectBoardEntry {
  status?: BoardStatus;
  memo?: string;
}
export interface BoardData {
  version: 1;
  plans: Record<string, PlanBoardEntry>;
  projects: Record<string, ProjectBoardEntry>;
}

function emptyBoard(): BoardData {
  return { version: 1, plans: {}, projects: {} };
}

function asStatus(v: unknown): BoardStatus | undefined {
  return typeof v === "string" && STATUSES.includes(v) ? (v as BoardStatus) : undefined;
}

/** 신뢰할 수 없는 입력(파일 내용/요청)을 board 스키마로 정제 — 화이트리스트 밖 값은 버린다. */
function sanitize(parsed: unknown): BoardData {
  const board = emptyBoard();
  if (!parsed || typeof parsed !== "object") return board;
  const p = parsed as Record<string, unknown>;

  const toEntry = (raw: unknown, withOverride: boolean): PlanBoardEntry => {
    const e: PlanBoardEntry = {};
    if (!raw || typeof raw !== "object") return e;
    const r = raw as Record<string, unknown>;
    const st = asStatus(r.status);
    if (st) e.status = st;
    if (typeof r.memo === "string" && r.memo) e.memo = r.memo;
    if (withOverride && typeof r.projectOverride === "string" && r.projectOverride) {
      e.projectOverride = r.projectOverride;
    }
    return e;
  };

  if (p.plans && typeof p.plans === "object") {
    for (const [k, v] of Object.entries(p.plans as Record<string, unknown>)) {
      board.plans[k] = toEntry(v, true);
    }
  }
  if (p.projects && typeof p.projects === "object") {
    for (const [k, v] of Object.entries(p.projects as Record<string, unknown>)) {
      board.projects[k] = toEntry(v, false);
    }
  }
  return board;
}

export async function readBoard(): Promise<BoardData> {
  const p = guardPath(BOARD_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyBoard();
    throw e;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    // 손상본은 옆에 보관하고 기본값으로 생존(페이지가 죽지 않게)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${BOARD_FILE}.corrupt.${stamp}`)).catch(() => {});
    return emptyBoard();
  }
}

async function rotateBackups(prefix: string) {
  const entries = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const mine = entries.filter((e) => e.startsWith(prefix)).sort();
  while (mine.length > BACKUP_KEEP) {
    const oldest = mine.shift()!;
    await fs.rm(path.join(BACKUP_DIR, oldest), { force: true });
  }
}

async function writeBoardAtomic(data: BoardData) {
  const p = guardPath(BOARD_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });

  // 현재본이 있으면 .bak 백업(로테이션) 후 덮어쓴다
  const current = await fs.readFile(p).catch(() => null);
  if (current) {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(path.join(BACKUP_DIR, `${path.basename(p)}.${stamp}.bak`), current);
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

export async function setPlanField(
  filename: string,
  patch: { status?: string; memo?: string; projectOverride?: string | null },
): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    const entry: PlanBoardEntry = { ...board.plans[filename] };
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
    board.plans[filename] = entry;
    pruneIfEmpty(board.plans, filename);
    await writeBoardAtomic(board);
    return board;
  });
}

export async function setProjectField(
  id: string,
  patch: { status?: string; memo?: string },
): Promise<BoardData> {
  return withLock(async () => {
    const board = await readBoard();
    const entry: ProjectBoardEntry = { ...board.projects[id] };
    if (patch.status !== undefined) {
      const st = asStatus(patch.status);
      if (st) entry.status = st;
    }
    if (patch.memo !== undefined) {
      if (patch.memo) entry.memo = patch.memo;
      else delete entry.memo;
    }
    board.projects[id] = entry;
    pruneIfEmpty(board.projects, id);
    await writeBoardAtomic(board);
    return board;
  });
}
