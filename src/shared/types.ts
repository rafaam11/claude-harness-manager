// renderer ↔ main IPC 계약. preload와 renderer가 함께 import한다(@shared).

// DT_GitManager에서 흡수한 git 도메인 타입(요청은 projectId 기반). 분량이 커서 별도 파일로 분리.
export * from "./git-types.js";

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
  appOpenPath: "app:open-path",
  appPickDirectory: "app:pick-directory",
  updaterCheck: "updater:check",
  updaterQuitAndInstall: "updater:quit-and-install",
  updaterStatus: "updater:status",
} as const;

/** electron-updater 진행 상태. main이 webContents.send로 push, UpdateBadge가 구독해 표시한다. */
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

export interface AppApi {
  /** 현재 앱 버전(app.getVersion). 사이드바 버전 배지에 표시. */
  getVersion: () => Promise<string>;
  /** GitHub 릴리스 페이지를 OS 브라우저로 연다(자동 업데이트 실패 시 수동 설치용 fallback). */
  openReleases: () => Promise<void>;
  /** 폴더 경로를 OS 파일 탐색기로 연다. 실패 시 에러 메시지, 성공 시 빈 문자열(shell.openPath 반환). */
  openPath: (target: string) => Promise<string>;
  /** 폴더 선택 dialog를 연다(Git repo 경로 수동 교정용). 취소 시 null. */
  pickDirectory: () => Promise<string | null>;
  /** 수동 "업데이트 확인". packaged에서 autoUpdater.checkForUpdates(), dev면 즉시 idle. */
  checkForUpdates: () => Promise<void>;
  /** 다운로드 완료된 업데이트를 적용하며 앱 재시작(autoUpdater.quitAndInstall). */
  quitAndInstall: () => Promise<void>;
  /** updater 상태 push 구독. 반환된 함수를 호출하면 해제된다(언마운트 시). */
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void) => () => void;
}
