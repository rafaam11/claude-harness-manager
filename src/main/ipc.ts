import { app, ipcMain } from "electron";
import { routeRequest } from "./router.js";
import { checkForUpdates, quitAndInstall } from "./updater.js";
import { IpcChannels, type ApiRequest, type ApiResult } from "@shared/types";

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
  ipcMain.handle(IpcChannels.updaterCheck, () => checkForUpdates());
  ipcMain.handle(IpcChannels.updaterQuitAndInstall, () => quitAndInstall());
}
