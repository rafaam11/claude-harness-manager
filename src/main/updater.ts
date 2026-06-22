import { app, type BrowserWindow } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import { IpcChannels, type UpdaterStatus } from "@shared/types";

// electron-updater는 CJS라 named import가 번들에서 깨진다 → default import 후 구조분해(issue #7976).
const { autoUpdater } = electronUpdater;

let mainWindow: BrowserWindow | null = null;

function send(status: UpdaterStatus): void {
  mainWindow?.webContents.send(IpcChannels.updaterStatus, status);
}

/**
 * autoUpdater 배선 + 앱 시작 시 조용한 자동 확인.
 * dev(app.isPackaged=false)에서는 "update config not provided" 에러가 나므로 비활성하고 항상 최신으로 표시한다.
 * public 저장소라 런타임 토큰 없이 GitHub 릴리스를 익명 조회한다(latest.yml + blockmap 차등 다운로드).
 */
export function initUpdater(win: BrowserWindow): void {
  mainWindow = win;
  if (!app.isPackaged) {
    send({ state: "idle" });
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => send({ state: "checking" }));
  autoUpdater.on("update-available", (i: UpdateInfo) =>
    send({ state: "available", version: i.version }),
  );
  autoUpdater.on("update-not-available", () => send({ state: "idle" }));
  autoUpdater.on("download-progress", (p: ProgressInfo) =>
    send({ state: "downloading", percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (i: UpdateInfo) =>
    send({ state: "downloaded", version: i.version }),
  );
  autoUpdater.on("error", (e: Error) => send({ state: "error", message: String(e?.message ?? e) }));

  void autoUpdater.checkForUpdatesAndNotify();
}

/** 수동 "업데이트 확인" 버튼 진입점. dev에서는 즉시 최신으로 응답. */
export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    send({ state: "idle" });
    return;
  }
  await autoUpdater.checkForUpdates();
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  // isSilent=true → NSIS에 /S를 붙여 인스톨러 창 없이 무음 설치(재설치하는 느낌 제거).
  // isForceRunAfter=true 필수: isSilent=true면 quitAndInstall이 install()의 재실행 인자로
  // autoRunAppAfterInstall 대신 isForceRunAfter를 쓰므로, 생략 시 설치 후 앱이 안 켜진다.
  autoUpdater.quitAndInstall(true, true);
}
