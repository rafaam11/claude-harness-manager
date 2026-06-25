import { shell } from "electron";

/**
 * 안전한 웹 스킴(http/https)일 때만 OS 브라우저로 연다. file:/javascript: 등은 무시.
 * index.ts(setWindowOpenHandler/will-navigate)와 ipc.ts(news 원문 링크 열기)가 공용으로 쓰는
 * 단일 검증 지점 — 임의 외부 URL을 열 때도 이 함수만 통과하게 한다.
 */
export function openExternalSafely(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    void shell.openExternal(rawUrl);
  }
}
