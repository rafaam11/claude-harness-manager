import {
  NEWS_GITHUB_RELEASES_URL,
  NEWS_ANTHROPIC_URL,
  NEWS_ANTHROPIC_BASE,
  NEWS_GEEKNEWS_URL,
  NEWS_AITIMES_URL,
  NEWS_YOZM_URL,
  NEWS_ETNEWS_URL,
  NEWS_ZDNET_URL,
  NEWS_IROBOT_URL,
  NEWS_HANKYUNG_URL,
  NEWS_CLAUDE_COUNT,
  NEWS_ANTHROPIC_COUNT,
  NEWS_RSS_COUNT,
  NEWS_SUMMARY_MAX,
  NEWS_BODY_MAX,
  NEWS_MEMORY_TTL_MS,
  NEWS_REFRESH_MIN_INTERVAL_MS,
} from "../config.js";
import { readNewsCache, writeNewsCacheAtomic } from "../lib/news-cache.js";
import { getFavoriteItem } from "../lib/favorites.js";
import { decodeEntities, extractSummary, parseFeed } from "../lib/rss.js";
import { fetchWithTimeout, abortMsg } from "../lib/http.js";
import type { NewsFeed, NewsItem, NewsSource, NewsSourceStatus } from "@shared/types";

/**
 * News 탭 라이브 피드. main 프로세스가 아홉 소스를 직접 fetch한다(renderer는 CSP로 외부 호출 불가).
 * 각 fetcher는 try/catch로 격리해 **throw하지 않고** 결과/상태를 반환한다 — 한 소스가 실패해도
 * 나머지 소스는 표시되는 graceful degradation이 핵심. 결과는 디스크 캐시(news-cache.json)에 저장하고
 * GET은 캐시 우선, POST(refresh)만 네트워크를 친다(수동 새로고침 위주).
 */

type FetchResult = { items: NewsItem[]; status: NewsSourceStatus };

function fail(source: NewsSource, error: string, prevFetchedAt: number): FetchResult {
  return { items: [], status: { source, ok: false, count: 0, error, fetchedAt: prevFetchedAt } };
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

// --- 3~9) 한국어 커뮤니티/매체 RSS (GeekNews Atom / 나머지 RSS 2.0) ---
/** 링크에서 안정 id 키 추출(GeekNews topic?id=N / AI타임스 idxno=N). 없으면 링크 자체(프로토콜 제외). */
function linkKey(link: string): string {
  const m = link.match(/[?&](?:id|idxno)=(\d+)/);
  return m ? m[1] : link.replace(/^https?:\/\//i, "");
}

/** 공용 RSS/Atom fetcher. 요약은 description 발췌 평문, 날짜 없는 항목(요즘IT)은 직전 캐시의 timestamp를 보존. */
async function fetchRss(
  source: NewsSource,
  url: string,
  idPrefix: string,
  prevFetchedAt: number,
  prevItems: NewsItem[],
): Promise<FetchResult> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return fail(source, `HTTP ${res.status}`, prevFetchedAt);
    const xml = await res.text();
    const entries = parseFeed(xml, NEWS_RSS_COUNT);
    // 0건이면 피드 구조 변경으로 간주(파싱 실패) — 직전 캐시 항목을 보존한다.
    if (entries.length === 0) {
      return fail(source, "파싱 결과 없음 (피드 구조 변경 가능)", prevFetchedAt);
    }
    const seen = new Set<string>();
    const items: NewsItem[] = [];
    for (const e of entries) {
      const id = `${idPrefix}${linkKey(e.link)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const summary = extractSummary(e.description, NEWS_SUMMARY_MAX);
      // 요즘IT는 Next.js SPA라 원문 웹페이지엔 서버 렌더 본문이 없다(클라이언트 하이드레이션 후
      // 채워짐) → fetchArticleBody가 JSON-LD의 개행 없는 flat articleBody로 폴백해 줄글이
      // 된다. 반면 RSS의 content:encoded(parseFeed가 description에 우선 채움)는 이미 문단
      // 구조가 살아있는 원문 HTML이므로, 원문 재fetch 없이 여기서 바로 마크다운으로 만든다.
      let body: string | undefined;
      if (source === "yozm" && e.description) {
        const md = htmlToMarkdown(e.description, e.link, NEWS_BODY_MAX);
        if (md.length >= 200) body = md;
      }
      items.push({
        id,
        source,
        title: e.title,
        url: e.link,
        // pubDate 부재(요즘IT)면 이미 본 항목의 시각을 보존, 신규만 지금 — 날짜 그룹이 흔들리지 않게.
        timestamp:
          e.publishedAt ?? prevItems.find((p) => p.id === id)?.timestamp ?? Date.now(),
        ...(summary ? { summary } : {}),
        ...(body ? { body } : {}),
        ...(e.image ? { image: e.image } : {}),
      });
    }
    return { items, status: { source, ok: true, count: items.length, fetchedAt: Date.now() } };
  } catch (e) {
    return fail(source, abortMsg(e), prevFetchedAt);
  }
}

/** 아홉 소스 fetch → 병합 역순 정렬 → 디스크 캐시 갱신. 실패 소스는 직전 캐시 항목을 보존한다. */
async function refreshUncached(): Promise<NewsFeed> {
  const prev = await readNewsCache();
  const prevAt = (s: NewsSource): number =>
    prev.sources.find((x) => x.source === s)?.fetchedAt ?? 0;
  const [cc, an, gn, at, yz, et, zd, rb, hk] = await Promise.all([
    fetchClaudeCode(prevAt("claude-code")),
    fetchAnthropic(prevAt("anthropic")),
    fetchRss("geeknews", NEWS_GEEKNEWS_URL, "gn-", prevAt("geeknews"), prev.items),
    fetchRss("aitimes", NEWS_AITIMES_URL, "at-", prevAt("aitimes"), prev.items),
    fetchRss("yozm", NEWS_YOZM_URL, "yozm-", prevAt("yozm"), prev.items),
    fetchRss("etnews", NEWS_ETNEWS_URL, "et-", prevAt("etnews"), prev.items),
    fetchRss("zdnet", NEWS_ZDNET_URL, "zd-", prevAt("zdnet"), prev.items),
    fetchRss("irobot", NEWS_IROBOT_URL, "rb-", prevAt("irobot"), prev.items),
    fetchRss("hankyung", NEWS_HANKYUNG_URL, "hk-", prevAt("hankyung"), prev.items),
  ]);
  // 실패한 소스는 직전 캐시의 그 소스 항목을 보존(완전 공백 방지).
  const keep = (s: NewsSource, r: FetchResult): NewsItem[] =>
    r.status.ok ? r.items : prev.items.filter((i) => i.source === s);
  const items = [
    ...keep("claude-code", cc),
    ...keep("anthropic", an),
    ...keep("geeknews", gn),
    ...keep("aitimes", at),
    ...keep("yozm", yz),
    ...keep("etnews", et),
    ...keep("zdnet", zd),
    ...keep("irobot", rb),
    ...keep("hankyung", hk),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const feed: NewsFeed = {
    version: 1,
    items,
    sources: [cc.status, an.status, gn.status, at.status, yz.status, et.status, zd.status, rb.status, hk.status],
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

// --- 기사 대표 이미지(og:image) lazy-fetch ---
// 피드에 이미지가 없는 소스는 원문 페이지의 og:image를 클릭 시점에만 1회 조회한다(refresh는 가볍게 유지).
const imageCache = new Map<string, string>(); // id → 해석된 이미지 URL(재클릭 재요청 방지)

/** 원문 HTML에서 og:image(없으면 twitter:image)를 추출. 실패/부재면 null. */
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const html = await res.text();
    // <meta property="og:image" content="…"> — property/content 속성 순서 양쪽 대응. og:image 없으면 twitter:image.
    const pick = (name: string): string | undefined => {
      const attr = `(?:property|name)=["']${name}["']`;
      const m =
        html.match(new RegExp(`<meta\\b[^>]*${attr}[^>]*\\bcontent=["']([^"']+)["']`, "i")) ??
        html.match(new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']+)["'][^>]*${attr}`, "i"));
      return m?.[1];
    };
    let img = pick("og:image") ?? pick("twitter:image");
    if (!img) return null;
    img = decodeEntities(img).trim();
    if (img.startsWith("//")) img = `https:${img}`; // 프로토콜 상대 URL 보정
    return /^https?:\/\//i.test(img) ? img : null;
  } catch {
    return null;
  }
}

/** POST /api/news/image: id로 캐시 피드에서 item을 찾아 인라인 이미지 우선, 없으면 og:image lazy-fetch(메모리 캐시). */
export async function getNewsImage(id: string): Promise<{ image: string | null }> {
  const feed = await getNews();
  // 피드에 없으면(즐겨찾기가 15개 상한에 밀려 빠짐) 저장된 스냅샷으로 fallback.
  const item = feed.items.find((i) => i.id === id) ?? (await getFavoriteItem(id));
  if (!item) return { image: null };
  if (item.image) return { image: item.image };
  const cached = imageCache.get(id);
  if (cached) return { image: cached };
  const image = await fetchOgImage(item.url);
  if (image) imageCache.set(id, image);
  return { image };
}

// --- 기사 전문(마크다운) lazy-fetch ---
// RSS 요약은 짧아 가독성이 부족하다. 선택 시 원문 페이지를 1회 fetch해 본문 영역을 **마크다운으로** 추출하고
// (문단/제목/목록/링크/본문 이미지 전부 보존) renderer가 claude-code 패치노트와 같은 marked 경로로 렌더한다.
// 추출 우선순위: <article> HTML(구조+이미지) → JSON-LD articleBody(평문) → meta description. 소스별 HTML이
// 제각각이라 완벽하지 않고, 실패하면 null(요약으로 fallback). 새 의존성 없이 정규식만 사용한다.
const bodyCache = new Map<string, string>(); // id → 추출 마크다운("" = 시도했으나 추출 실패)

/** 태그 문자열에서 속성 값 추출(첫 매치). */
function attrOf(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"));
  return m?.[1];
}

/** 상대/프로토콜 상대 URL을 원문 기준 절대 http(s)로 해석. 실패·비http면 null. */
function absUrl(href: string, base: string): string | null {
  try {
    const u = new URL(href.trim(), base);
    return /^https?:$/i.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * <img> 태그에서 실제 소스 추출(lazy-load 속성 우선). data:·비http·아이콘류는 버린다.
 * 공유버튼/SNS 아이콘/스피너/로고 SVG가 본문 사진처럼 섞여 나오는 것(etnews·hankyung)을 막는다.
 */
function imgSrc(tag: string, base: string): string | null {
  const raw =
    attrOf(tag, "data-src") ??
    attrOf(tag, "data-original") ??
    attrOf(tag, "data-lazy-src") ??
    attrOf(tag, "src") ??
    attrOf(tag, "srcset")?.split(",")[0]?.trim().split(/\s+/)[0];
  if (!raw || /^data:/i.test(raw)) return null;
  const cls = attrOf(tag, "class") ?? "";
  if (/(icon|sns|share|badge|spinner|loading|emoji|emoticon|avatar|profile|blank|dummy|placeholder|logo|btn)/i.test(cls)) {
    return null;
  }
  const u = absUrl(decodeEntities(raw), base);
  if (!u) return null;
  if (/\.svg(\?|$)/i.test(u)) return null; // SVG는 대개 아이콘/스피너(본문 사진은 jpg/png/webp)
  if (/(sprite|\bicon|logo|share|sns|bookmark|spinner|loading|blank|1x1|pixel|spacer|btn_)/i.test(u)) return null;
  return u;
}

// 기호/구분선만으로 이뤄진 줄(▲, ■, ─ 등). 캡션·본문 필터 양쪽에서 재사용.
const SYMBOL_ONLY_RE = /^[▲▼◀▶◁▷△▽▴▾■□◼◻○●◆◇★☆♥♡·•※#＃*_=~\-–—\s]+$/;

// 기사 본문에 섞여 들어오는 사이트 UI/부가 텍스트(스크랩·공유·글자크기·입력시각·저작권·기자 바이라인 등).
// 한 줄이 아래에 해당하면 통째로 버린다. 실제 본문을 지우지 않도록 보수적으로 고신뢰 패턴만 둔다.
// 주의: 한글은 \w가 아니라 \b 경계가 먹지 않는다 — 바이라인 등은 \s/문자열 끝으로만 앵커한다.
const BOILERPLATE_RE: RegExp[] = [
  /^(입력|수정|등록|승인|발행|송고|게재)\s*[:·]?\s*\d{4}[.\-/]/, // 입력 2026.07.03 09:06
  /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}(\s+\d{1,2}:\d{2})?$/, // 날짜/시각만 있는 줄
  /선호\s*출처로\s*추가/, // 구글 "선호 출처로 추가"
  /Google\s*검색에서/i,
  /무단\s*(전재|복제|배포|사용)/,
  /재\s*배포\s*금지/,
  /저작권자?\s*[ⓒ©(]/,
  /All rights reserved/i,
  /by\s*GN⁺/, // GeekNews 메타
  /★\s*favorite/i,
  /^댓글\s*\d+\s*개$/,
  SYMBOL_ONLY_RE, // 기호/구분선만
  /^[\w.+-]+@[\w.-]+\.\w+$/, // 기자 이메일만
  /^(글|사진|정리|취재|영상|편집|그래픽|디자인|자료)\s+[가-힣]{2,4}\s.*(기자|본부장|대표|팀장|부장|차장|과장|국장|위원|앵커|특파원|에디터|아나운서|연구원|교수|원장|소장|실장|센터장|PD)$/, // 바이라인
  /^[가-힣]{2,4}\s*기자(\s*[\w.+-]+@[\w.-]+)?$/, // "홍길동 기자" / "홍길동 기자 mail@x.com"
];

// 라벨만으로 이뤄진 줄(예: "기사 스크랩 기사 스크랩", "댓글 댓글", "글자크기 조절 글자크기")을 걸러낸다.
// 긴 라벨 우선으로 앞에서부터 소거해 줄이 전부 라벨로 소진되면 버린다(실제 문장은 라벨 아닌 토큰이 남아 보존).
const UI_LABELS = [
  "본문 글씨 키우기", "본문 글씨 줄이기", "글자크기 조절", "글자 크기", "글자크기",
  "기사 스크랩", "기사 공유", "스크랩", "공유하기", "공유", "프린트", "인쇄",
  "카카오톡", "카카오스토리", "페이스북", "트위터", "네이버", "밴드", "라인", "텔레그램",
  "URL 복사", "링크 복사", "주소 복사", "댓글", "좋아요", "구독", "구독하기", "SNS",
  "이전", "다음", "목록", "맨위로", "TOP",
].sort((a, b) => b.length - a.length);

function isLabelOnlyLine(line: string): boolean {
  let rest = line.replace(/\s+/g, " ").trim();
  if (!rest) return false;
  let consumed = false;
  while (rest.length) {
    const lb = UI_LABELS.find((l) => rest === l || rest.startsWith(l + " "));
    if (!lb) return false; // 라벨 아닌 실제 텍스트가 남음 → 이 줄은 본문일 수 있으니 보존
    rest = rest.slice(lb.length).trim();
    consumed = true;
  }
  return consumed;
}

function isBoilerplateLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (BOILERPLATE_RE.some((re) => re.test(t))) return true;
  if (isLabelOnlyLine(t)) return true;
  return false;
}

/** 본문 영역 HTML → 마크다운. 인라인 서식·이미지·링크를 보존하고 나머지 태그는 제거한다. */
function htmlToMarkdown(html: string, base: string, maxLen: number): string {
  // 일부 피드(요즘IT)는 원문 HTML 전체(CDATA 마커까지)가 통째로 한 번 더 엔티티 이스케이프되어
  // 온다 — 실제 태그가 하나도 없이 &lt; 표기만 있으면 1회 복원한다(extractSummary/firstImage와
  // 동일한 가드). 이걸 빼먹으면 태그 매칭이 전부 실패해 원문이 구조 없이 그대로 노출된다.
  let s = html;
  if (!/<[a-zA-Z!]/.test(s) && /&lt;[a-zA-Z!]/.test(s)) {
    s = decodeEntities(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  }
  s = s
    // 비본문 블록 제거
    .replace(/<(script|style|noscript|svg|iframe|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // 이미지: 본문에 등장하는 모든 <img>를 인라인 마크다운 이미지로. (해석 실패분은 제거)
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = imgSrc(tag, base);
    return src ? `\n\n![](${src})\n\n` : "";
  });
  // figcaption → 이탤릭 캡션(기호만 있는 캡션 ▲/■ 등은 버린다)
  s = s.replace(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi, (_m, inner) => {
    const t = stripTags(inner);
    return t && !SYMBOL_ONLY_RE.test(t) ? `\n\n*${t}*\n\n` : "";
  });
  // 헤딩
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) => {
    const t = stripTags(inner);
    return t ? `\n\n${"#".repeat(Number(lvl))} ${t}\n\n` : "";
  });
  // 링크(인라인 서식 유지 위해 태그 제거 전에)
  // 일부 피드(요즘IT)는 본문 전체를 스퓨리어스한 <b>...</b> 하나로 통째로 감싸서 내려보낸다 —
  // inner에 <p>/<h*> 등 블록 태그가 섞여 있으면(=인라인 태그가 아니라 문서 전체를 삼킨 것) 변환을
  // 건너뛰고 원문 그대로 둔다. 그냥 stripTags를 적용하면 아직 안 변환된 문단 개행이 공백 정규화로
  // 통째로 뭉개져 본문 전체가 한 줄로 붕괴되고, 그 한 줄이 저작권 문구 때문에 보일러플레이트로
  // 걸러져 본문이 통째로 사라진다.
  const BLOCK_TAG_RE =
    /<\/?(p|div|section|article|ul|ol|li|table|tr|td|th|blockquote|figure|h[1-6])\b/i;
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href: string, inner: string) => {
    if (BLOCK_TAG_RE.test(inner)) return m;
    const t = stripTags(inner);
    if (!t) return "";
    const u = absUrl(decodeEntities(href), base);
    return u ? `[${t}](${u})` : t;
  });
  // 강조
  s = s
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, _t, inner: string) =>
      BLOCK_TAG_RE.test(inner) ? m : `**${stripTags(inner)}**`,
    )
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, _t, inner: string) =>
      BLOCK_TAG_RE.test(inner) ? m : `*${stripTags(inner)}*`,
    );
  // 목록: <ul>/<ol> 시작 앞에도 빈 줄을 넣어 목록이 앞 문단에 붙어 파싱 실패하는 것을 막는다.
  s = s.replace(/<(ul|ol)\b[^>]*>/gi, "\n\n");
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${stripTags(inner)}`);
  // 블록 경계 → 문단 구분
  s = s
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|blockquote|tr|h[1-6])\s*>/gi, "\n\n");
  // 남은 태그 제거 + 엔티티 복원
  s = decodeEntities(s.replace(/<[^>]+>/g, " "));
  // 줄 단위 정리 + 보일러플레이트(스크랩·공유·입력시각·저작권·바이라인 등) 제거
  s = s
    .split("\n")
    .filter((ln) => !isBoilerplateLine(ln))
    .map((ln) => ln.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, "") + " …";
  return s;
}

/** 태그 제거 + 엔티티 복원 + 공백 정규화(인라인 텍스트용). */
function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// 여는 태그 위치에서 같은 태그의 depth를 세어 매칭 닫는 지점까지의 내부 HTML을 잘라낸다(정규식은 중첩을
// 못 세므로). 언밸런스면 문서 끝까지 반환.
function sliceElement(html: string, startIdx: number, tag: string): string | null {
  const gt = html.indexOf(">", startIdx);
  if (gt < 0) return null;
  const contentStart = gt + 1;
  let depth = 1;
  const tokRe = new RegExp(`<${tag}\\b|</${tag}\\s*>`, "gi");
  tokRe.lastIndex = contentStart;
  let m: RegExpExecArray | null;
  while ((m = tokRe.exec(html))) {
    if (m[0][1] === "/") {
      if (--depth === 0) return html.slice(contentStart, m.index);
    } else depth++;
  }
  return html.slice(contentStart);
}

// 본문 컨테이너 후보(id·class에 이 토큰이 들어가면 본문 영역으로 본다). 가장 앞선 토큰이 우선.
// <article> 태그는 공유바·관련기사·헤더까지 감싸는 매체가 많아(etnews/hankyung) 특정 컨테이너를 먼저 찾는다.
const CONTENT_TOKENS = [
  "articletxt", // 한국경제
  "article-view-content", "article_view_content", "article-content",
  "topic_contents", // GeekNews
  "articleBody", "article_body", "article-body",
  "news_body", "newsct_article", "art_txt", "read_body", "view_cont",
  "entry-content", "post-content",
];

/** 원문 페이지에서 본문 영역 HTML을 찾는다: itemprop=articleBody → 알려진 컨테이너 토큰 → 최장 <article>. */
function findContentRegion(html: string): string | undefined {
  const gate = (inner: string | null): string | undefined =>
    inner && stripTags(inner).length >= 150 ? inner : undefined;
  // 1) itemprop="articleBody" (schema.org 시맨틱 — 가장 신뢰도 높음)
  const ip = html.match(/<(div|section|article|main)\b[^>]*\bitemprop=["']articleBody["'][^>]*>/i);
  if (ip) {
    const r = gate(sliceElement(html, ip.index!, ip[1]));
    if (r) return r;
  }
  // 2) 알려진 본문 컨테이너 토큰
  for (const tok of CONTENT_TOKENS) {
    const re = new RegExp(
      `<(div|section|article|main)\\b[^>]*\\b(?:id|class)=["'][^"']*${tok}[^"']*["'][^>]*>`,
      "i",
    );
    const m = re.exec(html);
    if (m) {
      const r = gate(sliceElement(html, m.index, m[1]));
      if (r) return r;
    }
  }
  // 3) 최장 <article>
  const blocks = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map((m) => m[1]);
  if (blocks.length) return gate(blocks.sort((a, b) => b.length - a.length)[0]);
  return undefined;
}

/** JSON-LD(NewsArticle 등)에서 articleBody 문자열을 재귀 탐색(@graph/배열 포함). */
function jsonLdBody(html: string): string | undefined {
  for (const m of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const found = findKey(data, "articleBody");
    if (typeof found === "string" && found.trim()) return found;
  }
  return undefined;
}

/** 중첩 객체/배열에서 키를 DFS로 찾음(첫 문자열 매치 반환). */
function findKey(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const el of node) {
      const r = findKey(el, key);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (key in obj && typeof obj[key] === "string") return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key);
    if (r !== undefined) return r;
  }
  return undefined;
}

/** meta property/name의 content 추출(og:description 등). */
function metaContent(html: string, name: string): string | undefined {
  const attr = `(?:property|name)=["']${name}["']`;
  const m =
    html.match(new RegExp(`<meta\\b[^>]*${attr}[^>]*\\bcontent=["']([^"']*)["']`, "i")) ??
    html.match(new RegExp(`<meta\\b[^>]*\\bcontent=["']([^"']*)["'][^>]*${attr}`, "i"));
  return m?.[1];
}

/** 원문 페이지 → 본문 마크다운. article HTML(구조+이미지) 우선, 없으면 JSON-LD 평문, 그다음 meta description. */
async function fetchArticleBody(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const html = await res.text();
    // 1) 본문 컨테이너 HTML → 마크다운(문단·이미지 보존). 충분히 길면 채택.
    const region = findContentRegion(html);
    if (region) {
      const md = htmlToMarkdown(region, url, NEWS_BODY_MAX);
      if (md.length >= 200) return md;
    }
    // 2) JSON-LD articleBody(평문, 이미지 없음). 문단 구분 보존.
    const jb = jsonLdBody(html);
    if (jb) {
      const text = decodeEntities(jb).replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (text.length >= 120) return text.slice(0, NEWS_BODY_MAX);
    }
    // 3) meta description fallback(짧지만 없는 것보단 낫다).
    const desc = metaContent(html, "og:description") ?? metaContent(html, "description");
    return desc ? decodeEntities(desc).trim() : null;
  } catch {
    return null;
  }
}

/** POST /api/news/body: id로 원문 전문(마크다운) lazy-fetch. claude-code는 이미 body 보유 → 그대로 반환. */
export async function getNewsBody(id: string): Promise<{ body: string | null }> {
  const feed = await getNews();
  // 피드에 없으면(즐겨찾기가 15개 상한에 밀려 빠짐) 저장된 스냅샷의 url/body로 fallback.
  const item = feed.items.find((i) => i.id === id) ?? (await getFavoriteItem(id));
  if (!item) return { body: null };
  if (item.body) return { body: item.body }; // claude-code 패치노트 또는 yozm(content:encoded 변환) 마크다운
  // yozm은 SPA라 원문 페이지 fetch가 무의미(JSON-LD flat text만 나와 줄글 버그 재발) —
  // RSS content:encoded 변환이 실패/누락된 경우 요약으로만 fallback한다.
  if (item.source === "yozm") return { body: null };
  const cached = bodyCache.get(id);
  if (cached !== undefined) return { body: cached || null };
  const body = await fetchArticleBody(item.url);
  bodyCache.set(id, body ?? ""); // 실패도 캐시("")해 재클릭 재요청 방지
  return { body };
}
