// renderer ↔ main IPC 계약. preload와 renderer가 함께 import한다(@shared).

export type ApiMethod = "GET" | "PUT" | "POST";

/** renderer → main 요청. url은 기존 fetch 경로 문자열을 그대로 싣는다(예: "/api/workspace/plans?archived=1"). */
export interface ApiRequest {
  method: ApiMethod;
  url: string;
  body?: unknown;
}

/**
 * main → renderer 응답 봉투. throw 대신 봉투를 resolve해 statusCode를 무손실로 보존한다
 * (ipcMain.handle가 throw하면 Electron이 메시지를 "Error: ..."로 감싸 ApiError(status) 의미가 깨진다).
 */
export type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; statusCode: number; error: string };

export const IpcChannels = {
  apiInvoke: "api:invoke",
  appGetVersion: "app:get-version",
  appOpenReleases: "app:open-releases",
} as const;

export interface RendererApi {
  invoke: (req: ApiRequest) => Promise<ApiResult>;
}

export interface AppApi {
  /** 현재 앱 버전(app.getVersion). 사이드바 버전 배지에 표시. */
  getVersion: () => Promise<string>;
  /** GitHub 릴리스 페이지를 OS 브라우저로 연다(수동 업데이트: 최신 setup.exe를 직접 받아 설치). */
  openReleases: () => Promise<void>;
}
