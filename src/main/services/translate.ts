import {
  DEEPL_FREE_URL,
  DEEPL_PRO_URL,
  DEEPL_TIMEOUT_MS,
  DEEPL_MAX_BATCH,
  DEEPL_MAX_BODY_BYTES,
} from "../config.js";
import { getDeepLKey } from "../lib/secrets.js";
import { readTranslationCache, mergeTranslations } from "../lib/translation-cache.js";
import { maskText, isRestoreValid } from "../lib/mask.js";
import type { ItemTranslation, NewsItem, TranslateResponse } from "@shared/types";

/**
 * News 번역 오케스트레이션. main이 DeepL Free/Pro API를 직접 호출한다(renderer는 CSP로 불가).
 * 캐시 히트 분리 → 미번역만 마스킹 → DeepL 배치 → 복원 → 검증 게이트 → 캐시 머지.
 * 어떤 실패든 성공분은 반환(graceful degradation), 라우트는 항상 200.
 */

type Reason = NonNullable<TranslateResponse["reason"]>;

class TranslateError extends Error {
  constructor(
    public reason: Reason,
    message: string,
  ) {
    super(message);
  }
}

/** Free 키(:fx로 끝남)면 free 엔드포인트, 아니면 pro. */
function deeplEndpoint(key: string): string {
  return key.endsWith(":fx") ? DEEPL_FREE_URL : DEEPL_PRO_URL;
}

async function deeplFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEEPL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function toTranslateError(e: unknown): TranslateError {
  if (e instanceof TranslateError) return e;
  if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") {
    return new TranslateError("network", "DeepL 응답 시간 초과");
  }
  return new TranslateError("network", String((e as { message?: string })?.message ?? e));
}

/** 한 배치(≤50)를 번역해 입력 순서대로 반환. 상태코드를 reason으로 매핑. */
async function deeplBatch(key: string, texts: string[]): Promise<string[]> {
  const body = new URLSearchParams();
  body.set("target_lang", "KO");
  body.set("source_lang", "EN");
  body.set("preserve_formatting", "1");
  for (const t of texts) body.append("text", t);

  let res: Response;
  try {
    res = await deeplFetch(deeplEndpoint(key), {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
  } catch (e) {
    throw toTranslateError(e);
  }
  if (res.status === 401 || res.status === 403) {
    throw new TranslateError("auth", "DeepL 인증 실패 (키를 확인하세요)");
  }
  if (res.status === 456) throw new TranslateError("rate-limit", "DeepL 무료 한도 초과");
  if (res.status === 429) throw new TranslateError("rate-limit", "요청이 많습니다 (잠시 후 다시)");
  if (!res.ok) throw new TranslateError("network", `DeepL HTTP ${res.status}`);

  const data = (await res.json()) as { translations?: { text?: string }[] };
  if (!Array.isArray(data?.translations)) {
    throw new TranslateError("network", "DeepL 응답 형식 오류");
  }
  return data.translations.map((t) => t.text ?? "");
}

/** 마스킹된 본문을 \n\n 경계로(과대 문단은 줄 단위로 더) 쪼개 바이트 한도 내로. */
function splitForBudget(masked: string): string[] {
  const enc = (s: string): number => Buffer.byteLength(s, "utf8");
  if (enc(masked) <= DEEPL_MAX_BODY_BYTES) return [masked];
  const out: string[] = [];
  for (const para of masked.split(/\n\n/)) {
    if (enc(para) <= DEEPL_MAX_BODY_BYTES) {
      out.push(para);
      continue;
    }
    let buf = "";
    for (const line of para.split(/\n/)) {
      if (buf && enc(`${buf}\n${line}`) > DEEPL_MAX_BODY_BYTES) {
        out.push(buf);
        buf = line;
      } else {
        buf = buf ? `${buf}\n${line}` : line;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function translateItems(
  items: NewsItem[],
  opts: { withBody: boolean },
): Promise<TranslateResponse> {
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
