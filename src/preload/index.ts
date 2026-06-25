import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IpcChannels,
  type ApiRequest,
  type AppApi,
  type RendererApi,
  type UpdaterStatus,
} from "@shared/types";

const api: RendererApi = {
  invoke: (req: ApiRequest) => ipcRenderer.invoke(IpcChannels.apiInvoke, req),
};

const appApi: AppApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannels.appGetVersion),
  openReleases: () => ipcRenderer.invoke(IpcChannels.appOpenReleases),
  openPath: (target: string) => ipcRenderer.invoke(IpcChannels.appOpenPath, target),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.appOpenExternal, url),
  pickDirectory: () => ipcRenderer.invoke(IpcChannels.appPickDirectory),
  checkForUpdates: () => ipcRenderer.invoke(IpcChannels.updaterCheck),
  quitAndInstall: () => ipcRenderer.invoke(IpcChannels.updaterQuitAndInstall),
  onUpdaterStatus: (cb: (status: UpdaterStatus) => void) => {
    const listener = (_e: IpcRendererEvent, payload: UpdaterStatus): void => cb(payload);
    ipcRenderer.on(IpcChannels.updaterStatus, listener);
    return () => ipcRenderer.removeListener(IpcChannels.updaterStatus, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("app", appApi);
