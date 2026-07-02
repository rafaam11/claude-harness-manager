/**
 * RSS 2.0 / Atom 경량 파서(News 탭 한국어 소스용). anthropic 스크레이퍼와 같은 정규식 기반으로
 * 새 의존성 없이 두 포맷만 다룬다 — 파싱 0건이면 빈 배열을 반환하고 호출부(news.ts)가
 * "피드 구조 변경"으로 간주해 fail 처리한다(graceful degradation 유지).
 */

export interface FeedEntry {
  title: string;
  /** 원문 절대 URL(http/https만). */
  link: string;
  /** description/content 원문(CDATA 언랩됨, 태그 제거 전) — extractSummary로 정제해 쓴다. */
  description: string;
  /** pubDate/published의 epoch ms. 부재·파싱 실패면 undefined(요즘IT는 item에 pubDate가 없다). */
  publishedAt?: number;
}

/** 기본 HTML 엔티티 + 숫자 참조 복원(파서 라이브러리 없이). &amp;는 이중 복원을 피해 마지막에. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** 블록에서 <tag ...>내용</tag>의 내용을 추출(첫 매치). */
function field(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : undefined;
}

/** CDATA 언랩 → 태그 제거 → 엔티티 복원 → 공백 정규화(제목·날짜 등 한 줄 텍스트용). */
function cleanText(s: string | undefined): string {
  if (!s) return "";
  return decodeEntities(unwrapCdata(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Atom <link>는 self/alternate가 섞여 있어 rel="alternate" 우선, 없으면 rel 없는 링크. */
function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const pick =
    links.find((l) => /rel=["']alternate["']/i.test(l)) ??
    links.find((l) => !/rel=/i.test(l)) ??
    links[0];
  const href = pick?.match(/href=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]).trim() : "";
}

/** <rss>/<feed> 자동 감지 → item/entry 블록 분리 → 필드 추출. 제목/링크 없는 항목은 버린다. */
export function parseFeed(xml: string, maxItems: number): FeedEntry[] {
  const isAtom = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const out: FeedEntry[] = [];
  for (const block of xml.match(blockRe) ?? []) {
    if (out.length >= maxItems) break;
    const title = cleanText(field(block, "title"));
    const link = isAtom ? atomLink(block) : cleanText(field(block, "link"));
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const descRaw = isAtom
      ? (field(block, "content") ?? field(block, "summary") ?? "")
      : (field(block, "description") ?? "");
    const dateRaw = cleanText(field(block, isAtom ? "published" : "pubDate"));
    const ts = dateRaw ? Date.parse(dateRaw) : NaN;
    out.push({
      title,
      link,
      description: unwrapCdata(descRaw),
      publishedAt: Number.isFinite(ts) ? ts : undefined,
    });
  }
  return out;
}

/**
 * description HTML → 평문 요약. 블록 태그 경계는 줄바꿈으로 보존하고(리스트가 뭉개지지 않게)
 * 나머지 태그는 제거, maxLen 초과분은 단어 경계에서 절단한다. renderer는 이 값을 평문으로만
 * 렌더한다(dangerouslySetInnerHTML 금지 — 서드파티 HTML 주입 차단).
 */
export function extractSummary(html: string, maxLen: number): string {
  let s = unwrapCdata(html);
  // 엔티티로 이스케이프된 HTML(&lt;p&gt; …)도 태그 제거가 먹도록 1회 선복원.
  if (!/[<>]/.test(s) && /&lt;/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<\s*(?:br\s*\/?|\/p|\/li|\/h[1-6]|\/div|\/tr)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  s = decodeEntities(s)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s+\S*$/, "") + " …";
  return s;
}
