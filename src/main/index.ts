import { app, BrowserWindow, session } from "electron";
import { join } from "path";
import { registerIpcHandlers } from "./ipc.js";
import { initUpdater } from "./updater.js";
import { openExternalSafely } from "./lib/open-external.js";

/**
 * renderer가 로드/연결할 수 있는 대상을 제한한다. dev에서는 Vite가 eval/websocket을 쓰므로 건너뛴다.
 * index.html의 인라인 테마 스크립트와 React/vanilla-jsoneditor 인라인 스타일 때문에 script/style은 'unsafe-inline'.
 */
function setupCsp(): void {
  if (process.env["ELECTRON_RENDERER_URL"]) return;
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data:",
    "media-src 'self' https:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join("; ");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
    });
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.on("ready-to-show", () => win.show());

  // 카탈로그/계획 본문(marked)의 외부 링크는 새 창 대신 OS 브라우저로 연다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  // 단일 문서 SPA — 외부로의 최상위 네비게이션은 막고 OS 브라우저로 넘긴다.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

// 단일 인스턴스 강제: 포트 바인딩이 사라졌으므로 board.json 동시 쓰기를 막는 1차 방어(lock.ts가 2차).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    setupCsp();
    registerIpcHandlers();
    mainWindow = createWindow();
    initUpdater(mainWindow);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
