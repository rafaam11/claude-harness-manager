import fs from "node:fs/promises";
import path from "node:path";
import { GITHUB_STARS_CACHE_FILE, BACKUP_DIR, BACKUP_KEEP } from "../config.js";
import { guardPath } from "./path-guard.js";
import type { GitHubStarsFeed, GitHubRepo, GitHubStarsGroup, GitHubStarsGroupStatus } from "@shared/types";

/**
 * GitHub Stars의 디스크 캐시(앱 소유 데이터). news-cache.ts와 같은 mechanics —
 * guardPath allowlist 통과 + atomic temp/rename + .bak 로테이션 + 손상 시 corrupt 백업 후 빈 피드 생존.
 * 전체 교체라(필드 머지 아님) withLock 없이 atomic rename으로 충분하다(단일 인스턴스 가정).
 */

const GROUPS: readonly GitHubStarsGroup[] = ["trending", "new-popular"];

export function emptyFeed(): GitHubStarsFeed {
  return {
    version: 1,
    trending: [],
    newPopular: [],
    groups: GROUPS.map((group) => ({ group, ok: false, count: 0, fetchedAt: 0 })),
    lastFetch: 0,
    fetchedDay: "",
  };
}

function asGroup(v: unknown): GitHubStarsGroup | undefined {
  return typeof v === "string" && (GROUPS as readonly string[]).includes(v)
    ? (v as GitHubStarsGroup)
    : undefined;
}

export function sanitizeRepo(raw: unknown): GitHubRepo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const group = asGroup(r.group);
  if (!group) return undefined;
  if (typeof r.id !== "string" || !r.id) return undefined;
  if (typeof r.fullName !== "string" || !r.fullName) return undefined;
  if (typeof r.url !== "string" || !r.url) return undefined;
  if (typeof r.stars !== "number" || !Number.isFinite(r.stars)) return undefined;
  const repo: GitHubRepo = {
    id: r.id,
    fullName: r.fullName,
    description: typeof r.description === "string" ? r.description : null,
    url: r.url,
    language: typeof r.language === "string" ? r.language : null,
    stars: r.stars,
    group,
  };
  if (typeof r.starsToday === "number" && Number.isFinite(r.starsToday)) repo.starsToday = r.starsToday;
  if (typeof r.ownerAvatar === "string" && r.ownerAvatar) repo.ownerAvatar = r.ownerAvatar;
  if (typeof r.createdAt === "number" && Number.isFinite(r.createdAt)) repo.createdAt = r.createdAt;
  return repo;
}

/** 신뢰할 수 없는 캐시 파일 내용을 화이트리스트로 정제 — 형식 불량 항목/상태는 버린다. */
function sanitize(parsed: unknown): GitHubStarsFeed {
  const feed = emptyFeed();
  if (!parsed || typeof parsed !== "object") return feed;
  const p = parsed as Record<string, unknown>;

  if (Array.isArray(p.trending)) {
    feed.trending = p.trending.map(sanitizeRepo).filter((x): x is GitHubRepo => Boolean(x));
  }
  if (Array.isArray(p.newPopular)) {
    feed.newPopular = p.newPopular.map(sanitizeRepo).filter((x): x is GitHubRepo => Boolean(x));
  }

  if (Array.isArray(p.groups)) {
    const byKey = new Map<GitHubStarsGroup, GitHubStarsGroupStatus>();
    for (const raw of p.groups) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const group = asGroup(r.group);
      if (!group) continue;
      byKey.set(group, {
        group,
        ok: r.ok === true,
        count: typeof r.count === "number" && Number.isFinite(r.count) ? r.count : 0,
        error: typeof r.error === "string" && r.error ? r.error : undefined,
        fetchedAt:
          typeof r.fetchedAt === "number" && Number.isFinite(r.fetchedAt) ? r.fetchedAt : 0,
      });
    }
    feed.groups = GROUPS.map(
      (group) => byKey.get(group) ?? { group, ok: false, count: 0, fetchedAt: 0 },
    );
  }

  if (typeof p.lastFetch === "number" && Number.isFinite(p.lastFetch)) feed.lastFetch = p.lastFetch;
  if (typeof p.fetchedDay === "string") feed.fetchedDay = p.fetchedDay;
  return feed;
}

export async function readGitHubStarsCache(): Promise<GitHubStarsFeed> {
  const p = guardPath(GITHUB_STARS_CACHE_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyFeed();
    throw e;
  }
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    // 손상본은 옆에 보관하고 빈 피드로 생존(페이지가 죽지 않게) — news-cache.ts와 동일.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${GITHUB_STARS_CACHE_FILE}.corrupt.${stamp}`)).catch(() => {});
    return emptyFeed();
  }
}

async function rotateBackups(prefix: string): Promise<void> {
  const entries = await fs.readdir(BACKUP_DIR).catch(() => [] as string[]);
  const mine = entries.filter((e) => e.startsWith(prefix)).sort();
  while (mine.length > BACKUP_KEEP) {
    const oldest = mine.shift()!;
    await fs.rm(path.join(BACKUP_DIR, oldest), { force: true });
  }
}

export async function writeGitHubStarsCacheAtomic(feed: GitHubStarsFeed): Promise<void> {
  const p = guardPath(GITHUB_STARS_CACHE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });

  const current = await fs.readFile(p).catch(() => null);
  if (current) {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(path.join(BACKUP_DIR, `${path.basename(p)}.${stamp}.bak`), current);
    await rotateBackups(path.basename(p) + ".");
  }

  const tempPath = p + ".chm-tmp";
  await fs.writeFile(tempPath, JSON.stringify(feed, null, 2), "utf8");
  await fs.rename(tempPath, p);
}
