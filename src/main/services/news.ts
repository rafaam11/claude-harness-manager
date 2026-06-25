import {
  NEWS_GITHUB_RELEASES_URL,
  NEWS_ANTHROPIC_URL,
  NEWS_ANTHROPIC_BASE,
  NEWS_HN_SEARCH_URL,
  NEWS_HN_QUERY,
  NEWS_CLAUDE_COUNT,
  NEWS_ANTHROPIC_COUNT,
  NEWS_AI_COUNT,
  NEWS_FETCH_TIMEOUT_MS,
  NEWS_MEMORY_TTL_MS,
  NEWS_REFRESH_MIN_INTERVAL_MS,
} from "../config.js";
import { readNewsCache, writeNewsCacheAtomic } from "../lib/news-cache.js";
import type { NewsFeed, NewsItem, NewsSource, NewsSourceStatus } from "@shared/types";

/**
 * News 탭 라이브 피드. main 프로세스가 세 소스를 직접 fetch한다(renderer는 CSP로 외부 호출 불가).
 * 세 fetcher는 각각 try/catch로 격리해 **throw하지 않고** 결과/상태를 반환한다 — 한 소스가 실패해도
 * 나머지 소스는 표시되는 graceful degradation이 핵심. 결과는 디스크 캐시(news-cache.json)에 저장하고
 * GET은 캐시 우선, POST(refresh)만 네트워크를 친다(수동 새로고침 위주).
 */

type FetchResult = { items: NewsItem[]; status: NewsSourceStatus };

function fail(source: NewsSource, error: string, prevFetchedAt: number): FetchResult {
  return { items: [], status: { source, ok: false, count: 0, error, fetchedAt: prevFetchedAt } };
}

function abortMsg(e: unknown): string {
  if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") {
    return `시간 초과 (${Math.round(NEWS_FETCH_TIMEOUT_MS / 1000)}초)`;
  }
  return String((e as { message?: string })?.message ?? e);
}

/** AbortController 기반 타임아웃 fetch. Node 20+ 내장 fetch만 사용(새 의존성 없음). */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), NEWS_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": "claude-harness-manager", ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

/** 기본 HTML 엔티티만 정규식으로 복원(파서 라이브러리 없이). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

// 슬러그 단어 중 대문자로 표기할 흔한 약어(Tcs→TCS, Ai→AI 등). 화이트리스트라 안전.
const TITLE_ACRONYMS = new Set([
  "ai", "api", "sdk", "mcp", "llm", "cli", "ui", "ux", "us", "uk", "eu",
  "tcs", "dxc", "ibm", "aws", "gpu", "cpu", "io", "ml", "rag", "saas",
]);

/** 슬러그를 사람이 읽는 제목으로 복원(messy inner-text 추출을 피하는 안정 경로). */
function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) =>
      TITLE_ACRONYMS.has(w)
        ? w.toUpperCase()
        : w.length <= 1
          ? w.toUpperCase()
          : w[0].toUpperCase() + w.slice(1),
    )
    .join(" ");
}

/** GitHub 릴리스 body 끝의 자동 생성 Full Changelog 링크 줄만 보수적으로 제거. */
function trimReleaseBody(md: string): string {
  return md.replace(/\n*\*\*Full Changelog\*\*:.*$/s, "").trim();
}

// --- 1) Claude Code 릴리스 (GitHub API, 익명) ---
async function fetchClaudeCode(prevFetchedAt: number): Promise<FetchResult> {
  try {
    const res = await fetchWithTimeout(`${NEWS_GITHUB_RELEASES_URL}?per_page=${NEWS_CLAUDE_COUNT}`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return fail("claude-code", `HTTP ${res.status}`, prevFetchedAt);
    const arr: unknown = await res.json();
    if (!Array.isArray(arr)) return fail("claude-code", "예상치 못한 응답 형식", prevFetchedAt);
    const items: NewsItem[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.tag_name !== "string" || typeof r.published_at !== "string") continue;
      const ts = Date.parse(r.published_at);
      if (!Number.isFinite(ts)) continue;
      items.push({
        id: `cc-${r.tag_name}`,
        source: "claude-code",
        title: typeof r.name === "string" && r.name ? r.name : r.tag_name,
        url:
          typeof r.html_url === "string" && r.html_url
            ? r.html_url
            : `https://github.com/anthropics/claude-code/releases/tag/${r.tag_name}`,
        timestamp: ts,
        body: typeof r.body === "string" && r.body ? trimReleaseBody(r.body) : undefined,
      });
    }
    return {
      items,
      status: { source: "claude-code", ok: true, count: items.length, fetchedAt: Date.now() },
    };
  } catch (e) {
    return fail("claude-code", abortMsg(e), prevFetchedAt);
  }
}

// --- 2) Anthropic 공식 (HTML 정규식 추출) ---
async function fetchAnthropic(prevFetchedAt: number): Promise<FetchResult> {
  try {
    const res = await fetchWithTimeout(NEWS_ANTHROPIC_URL);
    if (!res.ok) return fail("anthropic", `HTTP ${res.status}`, prevFetchedAt);
    const html = await res.text();
    const items: NewsItem[] = [];
    const seen = new Set<string>();
    // <a ... href="/news/멀티-워드-슬러그" ...> 내부텍스트(날짜 포함) </a>
    // 단어 하나짜리(카테고리 페이지: /news/product 등)는 하이픈 요구로 걸러낸다. 구조 변경 시 매치 0 → ok:false.
    const re =
      /href=["'](\/news\/[a-z0-9]+(?:-[a-z0-9]+)+)["'][^>]*>([\s\S]{0,800}?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && items.length < NEWS_ANTHROPIC_COUNT) {
      const href = m[1];
      const slug = href.slice("/news/".length);
      if (seen.has(slug)) continue;
      seen.add(slug);
      const innerText = decodeEntities(m[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
      const dateMatch = innerText.match(/([A-Z][a-z]{2,8}\.?\s+\d{1,2},?\s+\d{4})/);
      const ts = dateMatch ? Date.parse(dateMatch[1]) : NaN;
      items.push({
        id: `anthropic-${slug}`,
        source: "anthropic",
        title: slugToTitle(slug),
        url: `${NEWS_ANTHROPIC_BASE}${href}`,
        timestamp: Number.isFinite(ts) ? ts : Date.now(),
      });
    }
    // 0건이면 페이지 구조 변경으로 간주(파싱 실패) — 다른 소스는 보존.
    if (items.length === 0) {
      return fail("anthropic", "파싱 결과 없음 (페이지 구조 변경 가능)", prevFetchedAt);
    }
    return {
      items,
      status: { source: "anthropic", ok: true, count: items.length, fetchedAt: Date.now() },
    };
  } catch (e) {
    return fail("anthropic", abortMsg(e), prevFetchedAt);
  }
}

// --- 3) 일반 AI 뉴스 (Hacker News Algolia, JSON) ---
async function fetchAiNews(prevFetchedAt: number): Promise<FetchResult> {
  try {
    const q = encodeURIComponent(NEWS_HN_QUERY);
    const url = `${NEWS_HN_SEARCH_URL}?query=${q}&tags=story&numericFilters=points%3E50&hitsPerPage=${NEWS_AI_COUNT}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return fail("ai", `HTTP ${res.status}`, prevFetchedAt);
    const data: unknown = await res.json();
    const hits = data && typeof data === "object" ? (data as { hits?: unknown }).hits : null;
    if (!Array.isArray(hits)) return fail("ai", "예상치 못한 응답 형식", prevFetchedAt);
    const items: NewsItem[] = [];
    for (const raw of hits) {
      if (!raw || typeof raw !== "object") continue;
      const h = raw as Record<string, unknown>;
      if (typeof h.title !== "string" || typeof h.objectID !== "string") continue;
      const ts = typeof h.created_at === "string" ? Date.parse(h.created_at) : NaN;
      // url 없는 Ask/Show HN 등은 HN 토론 페이지로 폴백.
      const link =
        typeof h.url === "string" && h.url
          ? h.url
          : `https://news.ycombinator.com/item?id=${h.objectID}`;
      const points = typeof h.points === "number" ? h.points : 0;
      const comments = typeof h.num_comments === "number" ? h.num_comments : 0;
      items.push({
        id: `hn-${h.objectID}`,
        source: "ai",
        title: h.title,
        url: link,
        timestamp: Number.isFinite(ts) ? ts : Date.now(),
        meta: `▲${points} · 💬${comments}`,
      });
    }
    return { items, status: { source: "ai", ok: true, count: items.length, fetchedAt: Date.now() } };
  } catch (e) {
    return fail("ai", abortMsg(e), prevFetchedAt);
  }
}

/** 세 소스 fetch → 병합 역순 정렬 → 디스크 캐시 갱신. 실패 소스는 직전 캐시 항목을 보존한다. */
async function refreshUncached(): Promise<NewsFeed> {
  const prev = await readNewsCache();
  const prevAt = (s: NewsSource): number =>
    prev.sources.find((x) => x.source === s)?.fetchedAt ?? 0;
  const [cc, an, ai] = await Promise.all([
    fetchClaudeCode(prevAt("claude-code")),
    fetchAnthropic(prevAt("anthropic")),
    fetchAiNews(prevAt("ai")),
  ]);
  // 실패한 소스는 직전 캐시의 그 소스 항목을 보존(완전 공백 방지).
  const keep = (s: NewsSource, r: FetchResult): NewsItem[] =>
    r.status.ok ? r.items : prev.items.filter((i) => i.source === s);
  const items = [...keep("claude-code", cc), ...keep("anthropic", an), ...keep("ai", ai)].sort(
    (a, b) => b.timestamp - a.timestamp,
  );
  const feed: NewsFeed = {
    version: 1,
    items,
    sources: [cc.status, an.status, ai.status],
    lastFetch: Date.now(),
  };
  await writeNewsCacheAtomic(feed);
  return feed;
}

// 메모리 캐시(중복 GET 보호) + inflight 합치기(스탬피드 방지) — recall.ts cached() 패턴 차용.
let memo: NewsFeed | undefined;
let memoAt = 0;
let inflight: Promise<NewsFeed> | null = null;

/** GET /api/news: 캐시 우선. 디스크 캐시 있으면 즉시 반환, 없으면(첫 실행) 1회 자동 fetch. */
export async function getNews(): Promise<NewsFeed> {
  if (memo && Date.now() - memoAt < NEWS_MEMORY_TTL_MS) return memo;
  const cached = await readNewsCache();
  if (cached.lastFetch > 0) {
    memo = cached;
    memoAt = Date.now();
    return cached;
  }
  // 첫 실행: 캐시 없음 → 1회 자동 fetch.
  return refreshNews();
}

/** POST /api/news/refresh: 강제 새로고침. inflight 합치기 + 최소 간격 가드(연타/rate limit 보호). */
export async function refreshNews(): Promise<NewsFeed> {
  if (inflight) return inflight;
  if (memo && memo.lastFetch > 0 && Date.now() - memo.lastFetch < NEWS_REFRESH_MIN_INTERVAL_MS) {
    return memo;
  }
  inflight = refreshUncached().then(
    (f) => {
      memo = f;
      memoAt = Date.now();
      inflight = null;
      return f;
    },
    (e) => {
      inflight = null;
      throw e;
    },
  );
  return inflight;
}
