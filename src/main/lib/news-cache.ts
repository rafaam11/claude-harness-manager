import fs from "node:fs/promises";
import path from "node:path";
import { NEWS_CACHE_FILE, BACKUP_DIR, BACKUP_KEEP } from "../config.js";
import { guardPath } from "./path-guard.js";
import type { NewsFeed, NewsItem, NewsSource, NewsSourceStatus } from "@shared/types";

/**
 * 라이브 뉴스의 디스크 캐시(앱 소유 데이터). board.ts와 같은 mechanics를 쓴다 —
 * guardPath allowlist 통과 + atomic temp/rename + .bak 로테이션 + 손상 시 corrupt 백업 후 빈 피드 생존.
 * News는 전체 교체라(필드 머지 아님) withLock 없이 atomic rename으로 충분하다(단일 인스턴스 가정).
 * board.json과 같은 BACKUP_DIR를 공유하므로 파일명 prefix(news-cache.json.)로 .bak 링이 섞이지 않게 한다.
 */

// 구 "ai"(HN) 소스 항목은 이 화이트리스트에서 빠져 sanitize 때 자연 탈락한다(별도 마이그레이션 없음).
const SOURCES: readonly NewsSource[] = ["claude-code", "anthropic", "geeknews", "aitimes", "yozm"];

export function emptyFeed(): NewsFeed {
  return {
    version: 1,
    items: [],
    sources: SOURCES.map((source) => ({ source, ok: false, count: 0, fetchedAt: 0 })),
    lastFetch: 0,
  };
}

function asSource(v: unknown): NewsSource | undefined {
  return typeof v === "string" && (SOURCES as readonly string[]).includes(v)
    ? (v as NewsSource)
    : undefined;
}

/** 신뢰할 수 없는 캐시 파일 내용을 화이트리스트로 정제 — 형식 불량 항목/상태는 버린다. */
function sanitize(parsed: unknown): NewsFeed {
  const feed = emptyFeed();
  if (!parsed || typeof parsed !== "object") return feed;
  const p = parsed as Record<string, unknown>;

  if (Array.isArray(p.items)) {
    const items: NewsItem[] = [];
    for (const raw of p.items) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const source = asSource(r.source);
      if (!source) continue;
      if (typeof r.id !== "string" || !r.id) continue;
      if (typeof r.title !== "string" || typeof r.url !== "string") continue;
      if (typeof r.timestamp !== "number" || !Number.isFinite(r.timestamp)) continue;
      const item: NewsItem = { id: r.id, source, title: r.title, url: r.url, timestamp: r.timestamp };
      if (typeof r.body === "string" && r.body) item.body = r.body;
      if (typeof r.summary === "string" && r.summary) item.summary = r.summary;
      if (typeof r.meta === "string" && r.meta) item.meta = r.meta;
      items.push(item);
    }
    feed.items = items;
  }

  if (Array.isArray(p.sources)) {
    const byKey = new Map<NewsSource, NewsSourceStatus>();
    for (const raw of p.sources) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const source = asSource(r.source);
      if (!source) continue;
      byKey.set(source, {
        source,
        ok: r.ok === true,
        count: typeof r.count === "number" && Number.isFinite(r.count) ? r.count : 0,
        error: typeof r.error === "string" && r.error ? r.error : undefined,
        fetchedAt:
          typeof r.fetchedAt === "number" && Number.isFinite(r.fetchedAt) ? r.fetchedAt : 0,
      });
    }
    // 항상 5소스 고정 순서로 정규화(누락된 소스는 기본값).
    feed.sources = SOURCES.map(
      (source) => byKey.get(source) ?? { source, ok: false, count: 0, fetchedAt: 0 },
    );
  }

  if (typeof p.lastFetch === "number" && Number.isFinite(p.lastFetch)) feed.lastFetch = p.lastFetch;
  return feed;
}

export async function readNewsCache(): Promise<NewsFeed> {
  const p = guardPath(NEWS_CACHE_FILE);
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
    // 손상본은 옆에 보관하고 빈 피드로 생존(페이지가 죽지 않게) — board.ts와 동일.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.rename(p, guardPath(`${NEWS_CACHE_FILE}.corrupt.${stamp}`)).catch(() => {});
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

export async function writeNewsCacheAtomic(feed: NewsFeed): Promise<void> {
  const p = guardPath(NEWS_CACHE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });

  // 현재본이 있으면 .bak 백업(로테이션) 후 덮어쓴다 — board.ts와 동일 패턴.
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
