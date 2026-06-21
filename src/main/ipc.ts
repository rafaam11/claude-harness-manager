import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { routeRequest } from "./router.js";
import { IpcChannels, type ApiRequest, type ApiResult } from "@shared/types";

// 비공개 저장소라 수동 업데이트: 버튼이 이 페이지를 OS 브라우저로 연다(로그인 상태면 최신 setup.exe를 받을 수 있다).
const RELEASES_URL = "https://github.com/digitrack-inc/claude-harness-manager/releases/latest";

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
  // 프로젝트 폴더를 OS 탐색기로 연다(로컬 단독 전제). 실패 시 에러 문자열을 그대로 돌려준다.
  ipcMain.handle(IpcChannels.appOpenPath, (_e, target: string) => shell.openPath(target));
  // 폴더 선택 dialog(Git repo 경로 수동 교정용). 취소하면 null.
  ipcMain.handle(IpcChannels.appPickDirectory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });
}
