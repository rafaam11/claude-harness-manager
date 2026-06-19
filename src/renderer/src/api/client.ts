import type { ApiMethod, ApiResult } from "@shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// 전송 계층만 IPC로 교체. 공개 표면(api.get/put/post, ApiError, fmt*)은 HTTP 시절과 동일하다.
// main이 throw 대신 ApiResult 봉투를 resolve하므로 여기서 statusCode를 복원해 ApiError로 던진다.
async function call<T>(method: ApiMethod, url: string, body?: unknown): Promise<T> {
  const res: ApiResult = await window.api.invoke({ method, url, body });
  if (!res.ok) throw new ApiError(res.statusCode, res.error);
  return res.data as T;
}

export const api = {
  get: <T>(url: string) => call<T>("GET", url),
  put: <T>(url: string, body: unknown) => call<T>("PUT", url, body),
  post: <T>(url: string, body?: unknown) => call<T>("POST", url, body ?? {}),
};

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** "오늘/어제/N일 전" 형태의 상대 시간. 회상 표면에서 "마지막 활동"을 직관적으로 보여준다. */
export function fmtRelative(ms: number): string {
  if (!ms) return "—";
  const day = 86400000;
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startThat = new Date(ms);
  startThat.setHours(0, 0, 0, 0);
  const dayDiff = Math.round((startToday.getTime() - startThat.getTime()) / day);
  if (dayDiff <= 0) {
    const diff = Date.now() - ms;
    const h = Math.floor(diff / 3600000);
    if (h < 1) return `${Math.max(1, Math.floor(diff / 60000))}분 전`;
    return `${h}시간 전`;
  }
  if (dayDiff === 1) return "어제";
  if (dayDiff < 7) return `${dayDiff}일 전`;
  return fmtDate(ms);
}
