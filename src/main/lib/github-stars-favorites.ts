import fs from "node:fs/promises";
import path from "node:path";
import { GITHUB_STARS_FAVORITES_FILE, BACKUP_DIR, BACKUP_KEEP } from "../config.js";
import { guardPath } from "./path-guard.js";
import { withLock } from "./lock.js";
import { sanitizeRepo } from "./github-stars-cache.js";
import type { StoredGitHubRepo } from "@shared/types";

/**
 * GitHub Stars 즐겨찾기(북마크) 저장소. favorites.ts(News)와 동일한 **앱 소유 파일** 패턴 —
 * withLock 직렬화 + atomic temp/rename + .bak 백업. baseHash 낙관적 동시성은 쓰지 않는다
 * (CC가 재작성하지 않는 앱 소유 파일이라 불필요).
 * 트렌딩/신규 인기는 그룹당 10개 상한 캐시라 즐겨찾기한 리포가 새로고침 후 목록에서 빠질 수 있어,
 * id가 아니라 GitHubRepo 스냅샷을 통째로 보관한다. 손상 시 손상본을 옆에 두고 기본값으로 생존한다.
 */

export interface FavoritesData {
  version: 1;
  items: Record<string, StoredGitHubRepo>;
}

function emptyFavorites(): FavoritesData {
  return { version: 1, items: {} };
}

/** 리포에는 News의 timestamp(발행 시각) 같은 개념이 없어 "최근 즐겨찾기한 것 먼저"로 정렬한다. */
function sortBySavedAt(items: Record<string, StoredGitHubRepo>): StoredGitHubRepo[] {
  return Object.values(items).sort((a, b) => b.savedAt - a.savedAt);
}

/** 신뢰할 수 없는 입력(파일 내용/요청)을 StoredGitHubRepo로 정제 — 필수 필드 없거나 형식 불량이면 null. */
function sanitizeItem(raw: unknown): StoredGitHubRepo | null {
  const repo = sanitizeRepo(raw);
  if (!repo) return null;
  const r = raw as Record<string, unknown>;
  const savedAt = typeof r.savedAt === "number" && Number.isFinite(r.savedAt) ? r.savedAt : Date.now();
  return { ...repo, savedAt };
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

async function readGitHubStarsFavorites(): Promise<FavoritesData> {
  const p = guardPath(GITHUB_STARS_FAVORITES_FILE);
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
    // 손상본은 옆에 보관하고 기본값으로 생존(페이지가 죽지 않게)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${GITHUB_STARS_FAVORITES_FILE}.corrupt.${stamp}`)).catch(() => {});
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

async function writeGitHubStarsFavoritesAtomic(data: FavoritesData) {
  const p = guardPath(GITHUB_STARS_FAVORITES_FILE);
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

/** 즐겨찾기 목록(savedAt 역순 — 최근 즐겨찾기한 것 먼저). */
export async function listGitHubStarsFavorites(): Promise<StoredGitHubRepo[]> {
  const data = await readGitHubStarsFavorites();
  return sortBySavedAt(data.items);
}

/** renderer가 보낸 GitHubRepo 스냅샷을 정제해 저장. 유효하지 않으면 400. */
export async function addGitHubStarsFavorite(rawRepo: unknown): Promise<StoredGitHubRepo[]> {
  const item = sanitizeItem(rawRepo);
  if (!item) {
    const err = new Error("유효하지 않은 리포지토리") as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }
  return withLock(async () => {
    const data = await readGitHubStarsFavorites();
    // 이미 있으면 savedAt(추가 시각)은 보존하고 스냅샷만 갱신, 없으면 지금 시각.
    const prev = data.items[item.id];
    data.items[item.id] = { ...item, savedAt: prev?.savedAt ?? Date.now() };
    await writeGitHubStarsFavoritesAtomic(data);
    return sortBySavedAt(data.items);
  });
}

export async function removeGitHubStarsFavorite(id: string): Promise<StoredGitHubRepo[]> {
  return withLock(async () => {
    const data = await readGitHubStarsFavorites();
    delete data.items[id];
    await writeGitHubStarsFavoritesAtomic(data);
    return sortBySavedAt(data.items);
  });
}
