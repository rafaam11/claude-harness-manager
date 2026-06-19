import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import {
  IpcChannels,
  type ApiRequest,
  type RendererApi,
  type UpdaterApi,
  type UpdaterStatus,
} from "@shared/types";

const api: RendererApi = {
  invoke: (req: ApiRequest) => ipcRenderer.invoke(IpcChannels.apiInvoke, req),
};

const updater: UpdaterApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannels.appGetVersion),
  check: () => ipcRenderer.invoke(IpcChannels.updaterCheck),
  quitAndInstall: () => ipcRenderer.invoke(IpcChannels.updaterQuitAndInstall),
  onStatus: (cb) => {
    const listener = (_e: IpcRendererEvent, payload: UpdaterStatus): void => cb(payload);
    ipcRenderer.on(IpcChannels.updaterStatus, listener);
    return () => ipcRenderer.removeListener(IpcChannels.updaterStatus, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("updater", updater);
