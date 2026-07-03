import fs from "node:fs/promises";
import path from "node:path";
import { FAVORITES_FILE, BACKUP_DIR, BACKUP_KEEP } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";
import type { NewsSource, StoredFavorite } from "@shared/types";

/**
 * News 즐겨찾기(북마크) 저장소. board.ts와 동일한 **앱 소유 파일** 패턴 —
 * withLock 직렬화 + atomic temp/rename + .bak 백업. baseHash 낙관적 동시성은 쓰지 않는다
 * (CC가 재작성하지 않는 앱 소유 파일이라 불필요, board.ts와 같은 이유).
 * 피드는 소스별 15개 상한이라 즐겨찾기한 기사가 새로고침 후 피드에서 빠질 수 있어,
 * id가 아니라 NewsItem 스냅샷을 통째로 보관한다. 손상 시 손상본을 옆에 두고 기본값으로 생존한다.
 */

const NEWS_SOURCES: readonly NewsSource[] = [
  "claude-code",
  "anthropic",
  "geeknews",
  "aitimes",
  "yozm",
  "etnews",
  "zdnet",
  "irobot",
  "hankyung",
];
const SOURCE_SET = new Set<string>(NEWS_SOURCES);

export interface FavoritesData {
  version: 1;
  items: Record<string, StoredFavorite>;
}

function emptyFavorites(): FavoritesData {
  return { version: 1, items: {} };
}

function sortByTime(items: Record<string, StoredFavorite>): StoredFavorite[] {
  return Object.values(items).sort((a, b) => b.timestamp - a.timestamp);
}

/** 신뢰할 수 없는 입력(파일 내용/요청)을 StoredFavorite로 정제 — 필수 필드 없거나 형식 불량이면 null. */
function sanitizeItem(raw: unknown): StoredFavorite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;
  if (typeof r.source !== "string" || !SOURCE_SET.has(r.source)) return null;
  if (typeof r.title !== "string" || !r.title) return null;
  if (typeof r.url !== "string" || !r.url) return null;
  if (typeof r.timestamp !== "number" || !Number.isFinite(r.timestamp)) return null;
  const fav: StoredFavorite = {
    id: r.id,
    source: r.source as NewsSource,
    title: r.title,
    url: r.url,
    timestamp: r.timestamp,
    savedAt:
      typeof r.savedAt === "number" && Number.isFinite(r.savedAt) ? r.savedAt : r.timestamp,
  };
  if (typeof r.body === "string") fav.body = r.body;
  if (typeof r.summary === "string") fav.summary = r.summary;
  if (typeof r.image === "string") fav.image = r.image;
  if (typeof r.meta === "string") fav.meta = r.meta;
  return fav;
}

function sanitize(parsed: unknown): FavoritesData {
  const data = emptyFavorites();
  if (!parsed || typeof parsed !== "object") return data;
  const p = parsed as Record<string, unknown>;
  if (p.items && typeof p.items === "object") {
    for (const [k, v] of Object.entries(p.items as Record<string, unknown>)) {
      const item = sanitizeItem(v);
      if (item && item.id === k) data.items[k] = item; // 키와 id 불일치 항목은 버린다
    }
  }
  return data;
}

export async function readFavorites(): Promise<FavoritesData> {
  const p = guardPath(FAVORITES_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyFavorites();
    throw e;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    // 손상본은 옆에 보관하고 기본값으로 생존(News 페이지가 죽지 않게)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${FAVORITES_FILE}.corrupt.${stamp}`)).catch(() => {});
    return emptyFavorites();
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

async function writeFavoritesAtomic(data: FavoritesData) {
  const p = guardPath(FAVORITES_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });

  // 현재본이 있으면 .bak 백업(로테이션) 후 덮어쓴다 — 사용자 curation이라 데이터 가치가 높다.
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

/** 즐겨찾기 목록(timestamp 역순 — 기존 피드와 동일 정렬로 날짜 그룹이 일관되게). */
export async function listFavorites(): Promise<StoredFavorite[]> {
  const data = await readFavorites();
  return sortByTime(data.items);
}

/** news.ts lazy-fetch fallback용 — 피드에서 빠진 즐겨찾기의 url/body를 되찾는다. */
export async function getFavoriteItem(id: string): Promise<StoredFavorite | null> {
  const data = await readFavorites();
  return data.items[id] ?? null;
}

/** renderer가 보낸 NewsItem 스냅샷을 정제해 저장. 유효하지 않으면 400. */
export async function addFavorite(rawItem: unknown): Promise<StoredFavorite[]> {
  const item = sanitizeItem(rawItem);
  if (!item) {
    const err = new Error("유효하지 않은 뉴스 항목") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
  return withLock(async () => {
    const data = await readFavorites();
    // 이미 있으면 savedAt(추가 시각)은 보존하고 스냅샷만 갱신, 없으면 지금 시각.
    const prev = data.items[item.id];
    data.items[item.id] = { ...item, savedAt: prev?.savedAt ?? Date.now() };
    await writeFavoritesAtomic(data);
    return sortByTime(data.items);
  });
}

export async function removeFavorite(id: string): Promise<StoredFavorite[]> {
  return withLock(async () => {
    const data = await readFavorites();
    delete data.items[id];
    await writeFavoritesAtomic(data);
    return sortByTime(data.items);
  });
}
