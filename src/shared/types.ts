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
  updaterCheck: "updater:check",
  updaterQuitAndInstall: "updater:quit-and-install",
  updaterStatus: "updater:status",
} as const;

/** 자동 업데이트 진행 상태. main이 webContents.send로 push, UpdateBadge가 표시한다. */
export type UpdaterStatus =
  | { state: "idle" } // 최신(또는 dev라 비활성)
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export interface RendererApi {
  invoke: (req: ApiRequest) => Promise<ApiResult>;
}

export interface UpdaterApi {
  getVersion: () => Promise<string>;
  check: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  /** 상태 변경 구독. 반환된 함수를 호출하면 해제된다(언마운트 시). */
  onStatus: (cb: (status: UpdaterStatus) => void) => () => void;
}
