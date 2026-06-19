import type { AppApi, RendererApi } from "@shared/types";

declare global {
  interface Window {
    api: RendererApi;
    app: AppApi;
  }
}
