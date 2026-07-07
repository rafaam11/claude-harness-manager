import { DEEPL_FREE_URL, DEEPL_PRO_URL, DEEPL_TIMEOUT_MS, DEEPL_MAX_BODY_BYTES } from "../config.js";
import type { TranslateReason } from "@shared/types";

/**
 * DeepL Free/Pro 호출 공용 클라이언트. News(services/translate.ts)와 GitHub Stars
 * (services/github-stars-translate.ts) 번역이 공유한다 — 엔드포인트 선택·타임아웃·
 * 상태코드→사유 매핑이 두 곳에서 갈라지면 한쪽만 고쳐지는 위험이 있어 여기 하나로 둔다.
 */

export class TranslateError extends Error {
  constructor(
    public reason: TranslateReason,
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

export function toTranslateError(e: unknown): TranslateError {
  if (e instanceof TranslateError) return e;
  if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") {
    return new TranslateError("network", "DeepL 응답 시간 초과");
  }
  return new TranslateError("network", String((e as { message?: string })?.message ?? e));
}

/** 한 배치(≤50)를 번역해 입력 순서대로 반환. 상태코드를 reason으로 매핑. */
export async function deeplBatch(key: string, texts: string[]): Promise<string[]> {
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
export function splitForBudget(masked: string): string[] {
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

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
