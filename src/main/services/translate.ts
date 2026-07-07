import { DEEPL_MAX_BATCH } from "../config.js";
import { getDeepLKey } from "../lib/secrets.js";
import { readTranslationCache, mergeTranslations } from "../lib/translation-cache.js";
import { maskText, isRestoreValid } from "../lib/mask.js";
import { deeplBatch, splitForBudget, chunk, toTranslateError } from "../lib/deepl-client.js";
import type { ItemTranslation, NewsItem, NewsSource, TranslateResponse, TranslateReason } from "@shared/types";

/**
 * News 번역 오케스트레이션. main이 DeepL Free/Pro API를 직접 호출한다(renderer는 CSP로 불가).
 * 캐시 히트 분리 → 미번역만 마스킹 → DeepL 배치 → 복원 → 검증 게이트 → 캐시 머지.
 * 어떤 실패든 성공분은 반환(graceful degradation), 라우트는 항상 200.
 * DeepL HTTP 호출 자체는 lib/deepl-client.ts 공용 클라이언트(GitHub Stars 번역과 공유).
 */

type Reason = TranslateReason;

// 원문이 이미 한국어인 소스 — 번역 대상에서 제외(renderer도 요청 전에 거르지만 이중 방어).
const KOREAN_SOURCES: ReadonlySet<NewsSource> = new Set([
  "geeknews",
  "aitimes",
  "yozm",
  "etnews",
  "zdnet",
  "irobot",
  "hankyung",
]);

export async function translateItems(
  items: NewsItem[],
  opts: { withBody: boolean },
): Promise<TranslateResponse> {
  items = items.filter((i) => !KOREAN_SOURCES.has(i.source));
  const key = await getDeepLKey();
  if (!key) {
    return { translations: {}, reason: "no-key", error: "DeepL 키가 설정되지 않았습니다" };
  }

  const cache = await readTranslationCache();
  const out: Record<string, ItemTranslation> = {};
  const fresh: Record<string, ItemTranslation & { at: number }> = {};
  let hadFailure = false;
  let stopReason: Reason | undefined;

  // 1) 캐시 히트 분리 → 미번역만 추림
  const needTitle: NewsItem[] = [];
  const needBody: NewsItem[] = [];
  for (const it of items) {
    const c = cache.items[it.id];
    if (c?.titleKo) {
      out[it.id] = { titleKo: c.titleKo, ...(c.bodyKo ? { bodyKo: c.bodyKo } : {}) };
    } else {
      needTitle.push(it);
    }
    if (opts.withBody && it.body && !c?.bodyKo) needBody.push(it);
  }
  if (needTitle.length === 0 && needBody.length === 0) {
    return { translations: out }; // 네트워크 0회
  }

  // 2) 제목 배치(≤50). 마스킹 → 번역 → 복원 → 검증
  for (const group of chunk(needTitle, DEEPL_MAX_BATCH)) {
    const masks = group.map((it) => maskText(it.title));
    let translated: string[];
    try {
      translated = await deeplBatch(
        key,
        masks.map((m) => m.masked),
      );
    } catch (e) {
      const te = toTranslateError(e);
      stopReason = te.reason;
      if (Object.keys(fresh).length) await mergeTranslations(fresh);
      return { translations: out, reason: stopReason, error: te.message };
    }
    group.forEach((it, i) => {
      const m = masks[i];
      const r = m.restore(translated[i] ?? "");
      if (isRestoreValid(m, r) && r.trim()) {
        out[it.id] = { ...(out[it.id] ?? {}), titleKo: r };
        fresh[it.id] = { titleKo: r, at: Date.now() };
      } else {
        hadFailure = true; // 원문 폴백, 캐시 안 함
      }
    });
  }

  // 3) 본문(항목별 — 길이 편차 큼). 마스킹 → 분할 → 배치 → 복원 → 검증
  for (const it of needBody) {
    if (!it.body) continue;
    const m = maskText(it.body);
    const parts = splitForBudget(m.masked);
    const tParts: string[] = [];
    try {
      for (const sub of chunk(parts, DEEPL_MAX_BATCH)) {
        tParts.push(...(await deeplBatch(key, sub)));
      }
    } catch (e) {
      const te = toTranslateError(e);
      stopReason = te.reason;
      hadFailure = true;
      continue; // 본문 실패는 제목 성공분 보존
    }
    const r = m.restore(tParts.join("\n\n"));
    if (isRestoreValid(m, r) && r.trim()) {
      const base = out[it.id]?.titleKo ?? cache.items[it.id]?.titleKo ?? it.title;
      out[it.id] = { titleKo: base, bodyKo: r };
      fresh[it.id] = { titleKo: fresh[it.id]?.titleKo ?? base, bodyKo: r, at: Date.now() };
    } else {
      hadFailure = true;
    }
  }

  if (Object.keys(fresh).length) await mergeTranslations(fresh);
  return { translations: out, reason: hadFailure ? (stopReason ?? "partial") : undefined };
}
