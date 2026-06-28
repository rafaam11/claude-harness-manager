import { SUBCAT_META, breadcrumbOf, type GlossaryTerm } from "./glossary";
import type { LiteTerm } from "./glossary-extra";
import type { CustomGlossaryData, CustomGlossaryTerm } from "@shared/types";

// 로컬 추천 매칭(순수함수, 데이터 비의존 — 타입만 import). 외부 호출 0.
// 핵심: 프롬프트에서 용어의 "내 표현"(한글 alias/termKo)은 썼지만 "정식 명칭"(영문 term)은
// 안 쓴 경우를 최우선 추천. 그 막연한 표현이 든 실제 문장(userSentence ❌)과 좋은 예시(goodExample ✅)를 함께 제공.
// 약점 영역: 그런 "헷갈림" 후보가 한 소분류에 몰리면 그 영역을 우선 노출.
// subcat/domain은 커스텀 도메인(custom:<domain>:<subcat>)도 담으므로 string.

export interface RecoCandidate {
  kind: "glossary" | "lite" | "custom";
  id?: string; // glossary 항목만 (클릭 시 펼침 연결)
  term: string;
  termKo: string;
  blurb: string;
  matchedAlias: string | null; // 감지된 "내 표현"(없으면 폴백 추천)
  userSentence?: string; // ❌ corpus에서 그 표현이 든 실제 문장 발췌
  goodExample?: string; // ✅ 정식 용어로 명확히 요청하는 좋은 프롬프트
  score: number;
  subcat: string;
  domain: string;
  crumb: string; // "대분류 > 소분류" 미리 합성(커스텀 포함)
}

export interface WeakArea {
  subcat: string;
  domain: string;
  label: string;
  breadcrumb: string;
  confusedCount: number;
}

export interface RecoResult {
  recos: RecoCandidate[];
  weakArea: WeakArea | null;
  fallback: boolean;
}

const W_ALIAS_NOT_TERM = 100; // 내 표현 O, 정식 term X → 최우선
const W_LITE_DETECT = 60; // 확장사전/커스텀 감지(정식 term X)
const W_LITE_WITH_TERM = 25;
const W_ALIAS_AND_TERM = 20; // 내 표현 O, 정식 term도 O(이미 앎)
const W_CURATED = 5; // 폴백 큐레이션
const W_WEAK_BOOST = 8; // 약점 영역 응집 — 티어 간격(최소 5)보다 작아 티어를 뒤집지 않음

// "헷갈림"으로 보는 점수(정식 영문 term 미사용) — 약점 집계 + userSentence 발췌 기준.
const CONFUSED_SCORES = new Set([W_ALIAS_NOT_TERM, W_LITE_DETECT]);

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ");
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function hasKorean(s: string): boolean {
  return /[가-힣]/.test(s);
}
function isAscii(s: string): boolean {
  return /^[a-z0-9 ]+$/i.test(s);
}

// corpus는 이미 norm된 상태로 받는다(호출자가 1회 normalize).
function hasPhrase(hayNorm: string, needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  if (/^[a-z0-9]+$/.test(n)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(n)}([^a-z0-9]|$)`).test(hayNorm);
  }
  return hayNorm.includes(n);
}

function userPhrasesOf(t: { termKo: string; aliases?: string[] }): string[] {
  return [t.termKo, ...(t.aliases ?? []).filter(hasKorean)].filter(Boolean);
}
function termFormsOf(t: { term: string; aliases?: string[] }): string[] {
  return [t.term, ...(t.aliases ?? []).filter(isAscii)].filter(Boolean);
}

// 원본 프롬프트들에서 alias가 등장한 문장을 발췌(90자 truncate). ❌ "내가 이렇게 썼어요"용.
function findUserSentence(rawTexts: string[], alias: string): string | undefined {
  const needle = alias.toLowerCase();
  for (const text of rawTexts) {
    for (const sent of text.split(/(?<=[.?!。\n])/)) {
      if (sent.toLowerCase().includes(needle)) {
        const s = sent.trim().replace(/\s+/g, " ");
        if (!s) continue;
        return s.length > 90 ? s.slice(0, 90) + "…" : s;
      }
    }
  }
  return undefined;
}

export function scoreGlossary(t: GlossaryTerm, corpus: string, raw: string[]): RecoCandidate | null {
  const matchedAlias = userPhrasesOf(t).find((a) => hasPhrase(corpus, a)) ?? null;
  if (!matchedAlias) return null;
  const termHit = termFormsOf(t).some((f) => hasPhrase(corpus, f));
  return {
    kind: "glossary",
    id: t.id,
    term: t.term,
    termKo: t.termKo,
    blurb: t.definition,
    matchedAlias,
    userSentence: termHit ? undefined : findUserSentence(raw, matchedAlias),
    goodExample: t.example,
    score: termHit ? W_ALIAS_AND_TERM : W_ALIAS_NOT_TERM,
    subcat: t.subcat,
    domain: SUBCAT_META[t.subcat].domain,
    crumb: breadcrumbOf(t.subcat),
  };
}

export function scoreLite(l: LiteTerm, corpus: string, raw: string[]): RecoCandidate | null {
  const matchedAlias = userPhrasesOf(l).find((a) => hasPhrase(corpus, a)) ?? null;
  if (!matchedAlias) return null;
  const termHit = hasPhrase(corpus, l.term);
  return {
    kind: "lite",
    term: l.term,
    termKo: l.termKo,
    blurb: l.blurb,
    matchedAlias,
    userSentence: termHit ? undefined : findUserSentence(raw, matchedAlias),
    goodExample: l.example,
    score: termHit ? W_LITE_WITH_TERM : W_LITE_DETECT,
    subcat: l.subcat,
    domain: SUBCAT_META[l.subcat].domain,
    crumb: breadcrumbOf(l.subcat),
  };
}

function scoreCustom(
  t: CustomGlossaryTerm,
  corpus: string,
  raw: string[],
  domainLabel: string,
  subcatLabel: string,
): RecoCandidate | null {
  const matchedAlias = userPhrasesOf(t).find((a) => hasPhrase(corpus, a)) ?? null;
  if (!matchedAlias) return null;
  const termHit = termFormsOf(t).some((f) => hasPhrase(corpus, f));
  return {
    kind: "custom",
    term: t.term,
    termKo: t.termKo,
    blurb: t.definition,
    matchedAlias,
    userSentence: termHit ? undefined : findUserSentence(raw, matchedAlias),
    goodExample: t.example,
    score: termHit ? W_LITE_WITH_TERM : W_LITE_DETECT,
    subcat: `custom:${t.domain}:${t.subcat}`,
    domain: `custom:${t.domain}`,
    crumb: `${domainLabel} > ${subcatLabel}`,
  };
}

const CURATED_FALLBACK = ["modal", "sidebar", "toast", "responsive", "api", "prompt", "commit"];

function lastSeg(crumb: string): string {
  const i = crumb.lastIndexOf(" > ");
  return i >= 0 ? crumb.slice(i + 3) : crumb;
}

function dedupeSort(cands: RecoCandidate[]): RecoCandidate[] {
  const seen = new Set<string>();
  return cands
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .filter((c) => (seen.has(c.term) ? false : (seen.add(c.term), true)));
}

// 전체 정렬 + 약점 영역을 반환. 호출자(Glossary.tsx)가 cursor로 3개씩 잘라 표시·"새 추천".
export function buildRecommendations(
  corpusTexts: string[],
  glossary: GlossaryTerm[],
  lite: LiteTerm[],
  custom?: CustomGlossaryData | null,
): RecoResult {
  const raw = corpusTexts; // 발췌용 원본
  const corpus = norm(corpusTexts.join("\n")); // 매칭용
  const cands: RecoCandidate[] = [];
  for (const t of glossary) {
    const c = scoreGlossary(t, corpus, raw);
    if (c) cands.push(c);
  }
  for (const l of lite) {
    const c = scoreLite(l, corpus, raw);
    if (c) cands.push(c);
  }
  if (custom) {
    const domLabel = new Map(custom.domains.map((d) => [d.id, d.label]));
    const subLabel = new Map<string, string>();
    for (const d of custom.domains) for (const s of d.subcats) subLabel.set(`${d.id}:${s.id}`, s.label);
    for (const t of custom.terms) {
      const c = scoreCustom(
        t,
        corpus,
        raw,
        domLabel.get(t.domain) ?? t.domain,
        subLabel.get(`${t.domain}:${t.subcat}`) ?? t.subcat,
      );
      if (c) cands.push(c);
    }
  }

  if (cands.length === 0) {
    // 폴백: 신규/빈 사용자 → 큐레이션 기본 추천("자주 쓰는 용어" 톤)
    for (const id of CURATED_FALLBACK) {
      const t = glossary.find((g) => g.id === id);
      if (t)
        cands.push({
          kind: "glossary",
          id: t.id,
          term: t.term,
          termKo: t.termKo,
          blurb: t.definition,
          matchedAlias: null,
          goodExample: t.example,
          score: W_CURATED,
          subcat: t.subcat,
          domain: SUBCAT_META[t.subcat].domain,
          crumb: breadcrumbOf(t.subcat),
        });
    }
    return { recos: dedupeSort(cands), weakArea: null, fallback: true };
  }

  // 소분류별 "헷갈림" 후보 수 집계 → 최다(≥2) 영역을 약점으로(count desc, subcat asc로 결정성).
  const byArea = new Map<string, number>();
  const areaCrumb = new Map<string, string>();
  for (const c of cands) {
    if (!areaCrumb.has(c.subcat)) areaCrumb.set(c.subcat, c.crumb);
    if (CONFUSED_SCORES.has(c.score)) byArea.set(c.subcat, (byArea.get(c.subcat) ?? 0) + 1);
  }
  let weak: WeakArea | null = null;
  const ranked = [...byArea.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length) {
    const [sc, n] = ranked[0];
    const crumb = areaCrumb.get(sc) ?? sc;
    const domain = cands.find((c) => c.subcat === sc)?.domain ?? "";
    weak = { subcat: sc, domain, label: lastSeg(crumb), breadcrumb: crumb, confusedCount: n };
    for (const c of cands) if (c.subcat === sc) c.score += W_WEAK_BOOST;
  }

  return { recos: dedupeSort(cands), weakArea: weak, fallback: false };
}
