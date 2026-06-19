import type { RendererApi, UpdaterApi } from "@shared/types";

declare global {
  interface Window {
    api: RendererApi;
    updater: UpdaterApi;
  }
}
