import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { routeRequest } from "./router.js";
import { checkForUpdates, quitAndInstall } from "./updater.js";
import { openExternalSafely } from "./lib/open-external.js";
import { exportFavoritesMarkdown } from "./services/news-export.js";
import { IpcChannels, type ApiRequest, type ApiResult } from "@shared/types";

// 자동 업데이트 실패 시 fallback: 버튼이 이 페이지를 OS 브라우저로 연다(최신 setup.exe 수동 설치용).
const RELEASES_URL = "https://github.com/rafaam11/harness-manager/releases/latest";

/**
 * 모든 renderer API 호출의 단일 진입점. 기존 Fastify HTTP 라우팅을 대체한다.
 * throw 대신 ApiResult 봉투를 resolve해 statusCode를 무손실로 전달한다(@shared/types 주석 참조).
 * 기존 server/src/index.ts:15-17 의 setErrorHandler 로직(err.statusCode ?? 500)이 여기로 들어왔다.
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.apiInvoke, async (_e, req: ApiRequest): Promise<ApiResult> => {
    try {
      return { ok: true, data: await routeRequest(req) };
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      return { ok: false, statusCode: e.statusCode ?? 500, error: e.message ?? String(err) };
    }
  });

  ipcMain.handle(IpcChannels.appGetVersion, () => app.getVersion());
  ipcMain.handle(IpcChannels.appOpenReleases, () => {
    void shell.openExternal(RELEASES_URL);
  });
  // 자동 업데이트 제어(electron-updater). dev에서는 updater 모듈이 즉시 idle로 응답한다.
  ipcMain.handle(IpcChannels.updaterCheck, () => checkForUpdates());
  ipcMain.handle(IpcChannels.updaterQuitAndInstall, () => quitAndInstall());
  // 프로젝트 폴더를 OS 탐색기로 연다(로컬 단독 전제). 실패 시 에러 문자열을 그대로 돌려준다.
  ipcMain.handle(IpcChannels.appOpenPath, (_e, target: string) => shell.openPath(target));
  // News 항목의 임의 외부 URL을 OS 브라우저로 연다. http/https만 허용(openExternalSafely 단일 검증 지점).
  ipcMain.handle(IpcChannels.appOpenExternal, (_e, url: string) => openExternalSafely(url));
  // 폴더 선택 dialog(Git repo 경로 수동 교정용). 취소하면 null.
  ipcMain.handle(IpcChannels.appPickDirectory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
  // 즐겨찾기(또는 지정 ids)를 폴더에 각 기사 .md로 저장. 다이얼로그는 여기(main)서, 본문 fetch·번역·쓰기는
  // 서비스에 위임. 취소하면 null. allowlist 밖 폴더 쓰기라 router/guardPath가 아닌 app IPC로 둔다.
  ipcMain.handle(IpcChannels.appExportFavorites, async (e, opts?: { ids?: string[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (res.canceled || res.filePaths.length === 0) return null;
    return exportFavoritesMarkdown(res.filePaths[0], opts?.ids);
  });
}
