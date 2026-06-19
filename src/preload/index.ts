import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels, type ApiRequest, type AppApi, type RendererApi } from "@shared/types";

const api: RendererApi = {
  invoke: (req: ApiRequest) => ipcRenderer.invoke(IpcChannels.apiInvoke, req),
};

const appApi: AppApi = {
  getVersion: () => ipcRenderer.invoke(IpcChannels.appGetVersion),
  openReleases: () => ipcRenderer.invoke(IpcChannels.appOpenReleases),
};

contextBridge.exposeInMainWorld("api", api);
contextBridge.exposeInMainWorld("app", appApi);
