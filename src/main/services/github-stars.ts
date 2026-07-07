import {
  GITHUB_TRENDING_URL,
  GITHUB_SEARCH_REPOS_URL,
  GITHUB_API_REPOS_URL,
  GITHUB_STARS_COUNT,
  GITHUB_NEW_REPO_WINDOW_DAYS,
  GITHUB_STARS_MEMORY_TTL_MS,
} from "../config.js";
import { readGitHubStarsCache, writeGitHubStarsCacheAtomic } from "../lib/github-stars-cache.js";
import { fetchWithTimeout, abortMsg } from "../lib/http.js";
import { decodeEntities } from "../lib/rss.js";
import type {
  GitHubRepo,
  GitHubStarsFeed,
  GitHubStarsGroup,
  GitHubStarsGroupStatus,
  GitHubReadme,
} from "@shared/types";

/**
 * News 탭 "GitHub Stars" 서브섹션. 두 소스를 병합하지 않고 독립 목록으로 유지한다 —
 * 트렌딩(github.com/trending HTML 스크래핑, 공식 API 부재)과 신규 인기(Search API, 비인증).
 * news.ts와 같은 graceful degradation 원칙: 한 그룹이 실패해도 다른 그룹은 표시되고, 실패한
 * 그룹은 직전 캐시 항목을 보존한다. 갱신은 "일일 1회"라 TTL이 아니라 fetchedDay(로컬 날짜) 비교로 게이트한다.
 */

type GroupFetchResult = { items: GitHubRepo[]; status: GitHubStarsGroupStatus };

function fail(group: GitHubStarsGroup, error: string, prevFetchedAt: number): GroupFetchResult {
  return { items: [], status: { group, ok: false, count: 0, error, fetchedAt: prevFetchedAt } };
}

/** 로컬 타임존 YYYY-MM-DD. 일일 캐시 유효성 판단 키(오늘과 다르면 재fetch 대상). */
function todayKey(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** 태그 제거 + 엔티티 복원 + 공백 정규화(news.ts의 stripTags와 동일 패턴). */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 태그 문자열에서 속성 값 추출(첫 매치, 속성 순서 무관). */
function attrOf(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return m?.[1];
}

// --- 1) 오늘의 트렌딩 (github.com/trending, HTML 정규식 추출 — 공식 API 없음) ---
async function fetchTrending(prevFetchedAt: number): Promise<GroupFetchResult> {
  try {
    const res = await fetchWithTimeout(GITHUB_TRENDING_URL);
    if (!res.ok) return fail("trending", `HTTP ${res.status}`, prevFetchedAt);
    const html = await res.text();
    const repos: GitHubRepo[] = [];
    // 각 리포는 <article class="Box-row">...</article> 블록 하나. 중첩 없음이 확인됨(non-greedy로 충분).
    for (const m of html.matchAll(
      /<article\b[^>]*\bclass="[^"]*\bBox-row\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g,
    )) {
      if (repos.length >= GITHUB_STARS_COUNT) break;
      const block = m[1];
      // 리포 링크는 <h2>의 <a href="/owner/repo">에만 있다(stargazers/forks 링크와 섞이지 않게 h2로 한정).
      const h2 = block.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
      const hrefM = h2?.[1].match(/href="\/([^"/]+\/[^"/]+)"/);
      if (!hrefM) continue;
      const fullName = decodeEntities(hrefM[1]);
      const descM = block.match(/<p\b[^>]*color-fg-muted[^>]*>([\s\S]*?)<\/p>/i);
      const description = descM ? stripTags(descM[1]) || null : null;
      const langM = block.match(/itemprop="programmingLanguage"[^>]*>([^<]*)</i);
      const language = langM ? decodeEntities(langM[1]).trim() || null : null;
      // 전체 스타 수: stargazers 링크 안의 숫자(svg 아이콘 포함이라 태그 제거 후 파싱).
      const starsM = block.match(/href="\/[^"]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/i);
      const stars = starsM ? parseInt(stripTags(starsM[1]).replace(/,/g, ""), 10) : NaN;
      if (!Number.isFinite(stars)) continue;
      // "오늘 획득한 스타"는 블록 전체를 평문화한 뒤 "N stars today" 문구로 추출(중첩 태그 구조에 안 흔들리게).
      const todayM = stripTags(block).match(/([\d,]+)\s+stars?\s+today/i);
      const starsToday = todayM ? parseInt(todayM[1].replace(/,/g, ""), 10) : undefined;
      // "Built by" 첫 기여자 아바타(리포 소유자 본인이 아닐 수 있으나 시각적 아이콘 용도로 충분).
      const avatarTag = block.match(/<img\b[^>]*avatar-user[^>]*>/i)?.[0];
      const ownerAvatarRaw = avatarTag ? attrOf(avatarTag, "src") : undefined;
      const repo: GitHubRepo = {
        id: `trending-${fullName}`,
        fullName,
        description,
        url: `https://github.com/${fullName}`,
        language,
        stars,
        group: "trending",
      };
      if (starsToday !== undefined) repo.starsToday = starsToday;
      if (ownerAvatarRaw) repo.ownerAvatar = decodeEntities(ownerAvatarRaw);
      repos.push(repo);
    }
    // 0건이면 페이지 구조 변경으로 간주(파싱 실패) — 다른 그룹은 보존.
    if (repos.length === 0) {
      return fail("trending", "파싱 결과 없음 (페이지 구조 변경 가능)", prevFetchedAt);
    }
    return {
      items: repos,
      status: { group: "trending", ok: true, count: repos.length, fetchedAt: Date.now() },
    };
  } catch (e) {
    return fail("trending", abortMsg(e), prevFetchedAt);
  }
}

// --- 2) 신규 인기 리포지토리 (Search API, 비인증) ---
async function fetchNewPopular(prevFetchedAt: number): Promise<GroupFetchResult> {
  try {
    const since = new Date(Date.now() - GITHUB_NEW_REPO_WINDOW_DAYS * 86400000)
      .toISOString()
      .slice(0, 10);
    const q = encodeURIComponent(`created:>${since}`);
    const url = `${GITHUB_SEARCH_REPOS_URL}?q=${q}&sort=stars&order=desc&per_page=${GITHUB_STARS_COUNT}`;
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) return fail("new-popular", `HTTP ${res.status}`, prevFetchedAt);
    const data: unknown = await res.json();
    const list =
      data && typeof data === "object" ? (data as Record<string, unknown>).items : undefined;
    if (!Array.isArray(list)) return fail("new-popular", "예상치 못한 응답 형식", prevFetchedAt);
    const items: GitHubRepo[] = [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.full_name !== "string" || typeof r.html_url !== "string") continue;
      if (typeof r.stargazers_count !== "number") continue;
      const owner = r.owner as Record<string, unknown> | undefined;
      const createdAt = typeof r.created_at === "string" ? Date.parse(r.created_at) : NaN;
      const repo: GitHubRepo = {
        id: `new-popular-${r.full_name}`,
        fullName: r.full_name,
        description: typeof r.description === "string" ? r.description : null,
        url: r.html_url,
        language: typeof r.language === "string" ? r.language : null,
        stars: r.stargazers_count,
        group: "new-popular",
      };
      if (Number.isFinite(createdAt)) repo.createdAt = createdAt;
      if (owner && typeof owner.avatar_url === "string") repo.ownerAvatar = owner.avatar_url;
      items.push(repo);
    }
    return {
      items,
      status: { group: "new-popular", ok: true, count: items.length, fetchedAt: Date.now() },
    };
  } catch (e) {
    return fail("new-popular", abortMsg(e), prevFetchedAt);
  }
}

/** 두 그룹 fetch → 디스크 캐시 갱신. 실패 그룹은 직전 캐시 항목을 보존한다. */
async function refreshUncached(): Promise<GitHubStarsFeed> {
  const prev = await readGitHubStarsCache();
  const prevAt = (g: GitHubStarsGroup): number =>
    prev.groups.find((x) => x.group === g)?.fetchedAt ?? 0;
  const [tr, np] = await Promise.all([
    fetchTrending(prevAt("trending")),
    fetchNewPopular(prevAt("new-popular")),
  ]);
  const feed: GitHubStarsFeed = {
    version: 1,
    trending: tr.status.ok ? tr.items : prev.trending,
    newPopular: np.status.ok ? np.items : prev.newPopular,
    groups: [tr.status, np.status],
    lastFetch: Date.now(),
    fetchedDay: todayKey(),
  };
  await writeGitHubStarsCacheAtomic(feed);
  return feed;
}

// 메모리 캐시(중복 GET 보호) + inflight 합치기(스탬피드 방지) — news.ts와 동일 패턴.
let memo: GitHubStarsFeed | undefined;
let memoAt = 0;
let inflight: Promise<GitHubStarsFeed> | null = null;

/** GET /api/github-stars: 오늘자 캐시가 있으면 그대로, 없으면(날짜가 바뀌었거나 최초 실행) 1회 자동 fetch. */
export async function getGitHubStars(): Promise<GitHubStarsFeed> {
  if (memo && Date.now() - memoAt < GITHUB_STARS_MEMORY_TTL_MS) return memo;
  const cached = await readGitHubStarsCache();
  if (cached.fetchedDay === todayKey()) {
    memo = cached;
    memoAt = Date.now();
    return cached;
  }
  return refreshGitHubStars();
}

/** POST /api/github-stars/refresh: day-gate 무시하고 강제 재fetch(장애 복구용). inflight 합치기로 중복 클릭 방지. */
export async function refreshGitHubStars(): Promise<GitHubStarsFeed> {
  if (inflight) return inflight;
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

// --- README 조회 (상세 패널 미리보기) ---
// "owner/repo" 형태만 허용 — 요청 바디 값이 URL 경로에 그대로 들어가므로 형식 밖 값은 조기 차단한다.
const FULL_NAME_RE = /^[\w.-]+\/[\w.-]+$/;

// 리포별 조회라 fullName을 키로 인메모리 캐시(news.ts의 bodyCache와 동일 패턴). 성공/실패 모두 캐시해
// 재클릭 시 비인증 API 레이트리밋(60회/시간)을 다시 두드리지 않는다. 디스크 영속화는 하지 않는다(세션 스코프).
const readmeCache = new Map<string, GitHubReadme>();

async function fetchReadme(fullName: string): Promise<GitHubReadme> {
  try {
    const res = await fetchWithTimeout(`${GITHUB_API_REPOS_URL}/${fullName}/readme`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (res.status === 404) return { markdown: null };
    if (!res.ok) return { markdown: null, error: `HTTP ${res.status}` };
    const data: unknown = await res.json();
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const htmlUrl = typeof d.html_url === "string" ? d.html_url : undefined;
    const downloadUrl = typeof d.download_url === "string" ? d.download_url : undefined;
    if (downloadUrl) {
      const raw = await fetchWithTimeout(downloadUrl);
      if (raw.ok) return { markdown: await raw.text(), htmlUrl, downloadUrl };
    }
    if (typeof d.content === "string") {
      return { markdown: Buffer.from(d.content, "base64").toString("utf8"), htmlUrl, downloadUrl };
    }
    return { markdown: null, htmlUrl, downloadUrl };
  } catch (e) {
    return { markdown: null, error: abortMsg(e) };
  }
}

/** POST /api/github-stars/readme: 인메모리 캐시 우선, 없으면 1회 fetch 후 캐시. */
export async function getGitHubReadme(fullName: string): Promise<GitHubReadme> {
  if (!FULL_NAME_RE.test(fullName)) return { markdown: null, error: "유효하지 않은 리포지토리" };
  const cached = readmeCache.get(fullName);
  if (cached) return cached;
  const result = await fetchReadme(fullName);
  readmeCache.set(fullName, result);
  return result;
}
