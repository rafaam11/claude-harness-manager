import { NEWS_FETCH_TIMEOUT_MS } from "../config.js";

/**
 * 외부 fetch 공용 유틸(news.ts에서 추출). AbortController 기반 타임아웃 + User-Agent 헤더.
 * Node 20+ 내장 fetch만 사용(새 의존성 없음). news / github-stars 서비스가 공유한다.
 */
export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = NEWS_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { "User-Agent": "harness-manager", ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

/** fetch 실패를 사람이 읽는 메시지로. AbortError면 "시간 초과 (N초)". */
export function abortMsg(e: unknown, timeoutMs: number = NEWS_FETCH_TIMEOUT_MS): string {
  if (e && typeof e === "object" && (e as { name?: string }).name === "AbortError") {
    return `시간 초과 (${Math.round(timeoutMs / 1000)}초)`;
  }
  return String((e as { message?: string })?.message ?? e);
}
