/**
 * ISO 문자열 → epoch ms. 파싱 실패(NaN)는 0으로 수렴시킨다 — 정렬에서 가장 오래된 것으로
 * 밀리고, stale 판정(now - t > threshold)도 "오래됨"으로 안전한 방향이 된다.
 */
export function parseTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
