import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, desktopCapturer, screen, type Rectangle } from "electron";

import {
  APP_NAME,
  IPC_CHANNELS,
  type ScreenCaptureSourceDescriptor,
  type ScreenShareViewerFrame,
} from "@private-voice/shared";

const devServerUrl = "http://127.0.0.1:5173";

interface CreateMainWindowOptions {
  log?: (
    level: "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  logsDirectory?: string;
}

const getBuildAssetPath = (fileName: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, "build", fileName)
    : path.join(app.getAppPath(), "build", fileName);

const getIconPath = () => getBuildAssetPath("shanghao-icon-v3.ico");

let pendingScreenCaptureSourceId: string | undefined;
let screenShareViewerWindow: BrowserWindow | null = null;
let latestScreenShareViewerFrame: ScreenShareViewerFrame | undefined;

const enumerateScreenCaptureSources = async (withThumbnails: boolean) =>
  desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: withThumbnails ? { width: 320, height: 180 } : { width: 0, height: 0 },
    fetchWindowIcons: withThumbnails,
  });

export const listScreenCaptureSources = async (): Promise<ScreenCaptureSourceDescriptor[]> => {
  const sources = await enumerateScreenCaptureSources(true);
  return sources.slice(0, 40).map((source) => ({
    id: source.id,
    name: source.name.slice(0, 120),
    kind: source.id.startsWith("screen:") ? "screen" : "window",
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    appIconDataUrl: source.appIcon?.toDataURL(),
  }));
};

export const selectScreenCaptureSource = (sourceId: string): void => {
  pendingScreenCaptureSourceId = sourceId;
};

const getRendererEntryPath = () => path.join(__dirname, "../../dist/index.html");

export const openScreenShareViewer = async (title: string): Promise<void> => {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  if (screenShareViewerWindow && !screenShareViewerWindow.isDestroyed()) {
    // Keep the detached viewer out of display capture to avoid a hall-of-mirrors loop
    // when the user shares the same monitor that contains this window.
    screenShareViewerWindow.setContentProtection(true);
    screenShareViewerWindow.setTitle(title);
    if (screenShareViewerWindow.isMinimized()) screenShareViewerWindow.restore();
    screenShareViewerWindow.setBounds(workArea, false);
    screenShareViewerWindow.show();
    screenShareViewerWindow.focus();
    return;
  }

  const viewer = new BrowserWindow({
    ...workArea,
    minWidth: 640,
    minHeight: 420,
    title,
    show: false,
    backgroundColor: "#0A0D12",
    icon: getIconPath(),
    resizable: true,
    maximizable: true,
    minimizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  screenShareViewerWindow = viewer;
  viewer.setContentProtection(true);
  viewer.setMenuBarVisibility(false);
  viewer.setAutoHideMenuBar(true);
  viewer.on("closed", () => {
    if (screenShareViewerWindow === viewer) {
      screenShareViewerWindow = null;
      latestScreenShareViewerFrame = undefined;
    }
  });

  if (app.isPackaged) {
    await viewer.loadFile(getRendererEntryPath(), { query: { screenViewer: "1" } });
  } else {
    await viewer.loadURL(`${devServerUrl}?screenViewer=1`);
  }
  if (latestScreenShareViewerFrame) {
    viewer.webContents.send(IPC_CHANNELS.screenShareViewer.frame, latestScreenShareViewerFrame);
  }
  viewer.setBounds(workArea, false);
  viewer.show();
  viewer.focus();
};

export const updateScreenShareViewer = (frame: ScreenShareViewerFrame): boolean => {
  const viewer = screenShareViewerWindow;
  if (!viewer || viewer.isDestroyed()) return false;
  latestScreenShareViewerFrame = frame;
  viewer.setTitle(frame.title);
  viewer.webContents.send(IPC_CHANNELS.screenShareViewer.frame, frame);
  return true;
};

export const closeScreenShareViewer = (): void => {
  latestScreenShareViewerFrame = undefined;
  const viewer = screenShareViewerWindow;
  screenShareViewerWindow = null;
  if (viewer && !viewer.isDestroyed()) viewer.close();
};

const createFallbackHtml = (
  title: string,
  description: string,
  logsDirectory?: string,
) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${APP_NAME}</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fa; color: #111827; }
      .card { width: min(580px, calc(100vw - 32px)); border: 1px solid #e7ecf2; border-radius: 24px; background: #fff; padding: 28px; box-shadow: 0 20px 60px rgba(17,24,39,.08); }
      h1 { margin: 0; font-size: 26px; }
      p { margin: 12px 0 0; font-size: 14px; line-height: 1.7; color: #667085; }
      code { display:block; margin-top:12px; padding:10px 12px; border-radius:12px; background:#f8fafc; color:#111827; word-break:break-all; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${description}</p>
      ${logsDirectory ? `<code>\u65E5\u5FD7\u76EE\u5F55\uFF1A${logsDirectory}</code>` : ""}
    </div>
  </body>
</html>`;

export const createMainWindow = ({
  log,
  logsDirectory,
}: CreateMainWindowOptions = {}): BrowserWindow => {
  const boundsPath = path.join(app.getPath("userData"), "window-bounds.json");
  let savedBounds: Partial<Rectangle> = {};
  try {
    if (existsSync(boundsPath)) savedBounds = JSON.parse(readFileSync(boundsPath, "utf8"));
  } catch {
    savedBounds = {};
  }
  const display = screen.getDisplayMatching({
    x: savedBounds.x ?? 0,
    y: savedBounds.y ?? 0,
    width: savedBounds.width ?? 1,
    height: savedBounds.height ?? 1,
  });
  const width = Math.min(display.workArea.width, Math.max(1120, savedBounds.width ?? 1440));
  const height = Math.min(display.workArea.height, Math.max(720, savedBounds.height ?? 900));
  const x = Math.min(
    display.workArea.x + display.workArea.width - width,
    Math.max(
      display.workArea.x,
      savedBounds.x ?? display.workArea.x + Math.round((display.workArea.width - width) / 2),
    ),
  );
  const y = Math.min(
    display.workArea.y + display.workArea.height - height,
    Math.max(
      display.workArea.y,
      savedBounds.y ?? display.workArea.y + Math.round((display.workArea.height - height) / 2),
    ),
  );
  const window = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#EEF5FF",
    frame: false,
    titleBarStyle: "hidden",
    title: APP_NAME,
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // NOTE: BrowserWindow#setAppDetails is a 36+ API that has stub types in
  // 35.x but no runtime implementation, so calling it crashes startup.
  // On macOS the dock icon is handled by the bundle, on Windows use
  // app.setAppUserModelId() before app.whenReady() if needed.

  const targetUrl = !app.isPackaged
    ? devServerUrl
    : pathToFileURL(path.join(__dirname, "../../dist/index.html")).toString();

  let hasShownFallback = false;

  const loadFallback = async (
    title: string,
    description: string,
    context?: Record<string, unknown>,
  ) => {
    if (hasShownFallback) {
      return;
    }

    hasShownFallback = true;
    log?.("error", title, context);
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        createFallbackHtml(title, description, logsDirectory),
      )}`,
    );
    window.show();
    window.focus();
  };

  const loadRenderer = async () => {
    try {
      if (!app.isPackaged) {
        await window.loadURL(devServerUrl);
      } else {
        await window.loadFile(path.join(__dirname, "../../dist/index.html"));
      }
    } catch (error) {
      await loadFallback(
        "\u8F6F\u4EF6\u542F\u52A8\u5931\u8D25",
        "\u4E0A\u53F7\u6CA1\u80FD\u987A\u5229\u6253\u5F00\u754C\u9762\uFF0C\u8BF7\u67E5\u770B\u65E5\u5FD7\u540E\u91CD\u8BD5\u3002",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || hasShownFallback) {
        return;
      }

      void loadFallback(
        "\u754C\u9762\u52A0\u8F7D\u5931\u8D25",
        "\u4E0A\u53F7\u6CA1\u80FD\u987A\u5229\u52A0\u8F7D\u4E3B\u754C\u9762\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
        {
          errorCode,
          errorDescription,
          validatedURL,
          targetUrl,
        },
      );
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    void loadFallback(
      "\u754C\u9762\u610F\u5916\u9000\u51FA",
      "\u6E32\u67D3\u8FDB\u7A0B\u5DF2\u7ECF\u9000\u51FA\uFF0C\u8BF7\u6839\u636E\u65E5\u5FD7\u68C0\u67E5\u542F\u52A8\u95EE\u9898\u3002",
      {
        reason: details.reason,
        exitCode: details.exitCode,
      },
    );
  });

  window.webContents.on("unresponsive", () => {
    log?.("warn", "Renderer became unresponsive");
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    log?.("warn", "Blocked unexpected window open", { url });
    return { action: "deny" };
  });

  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);
  const isTrustedRendererUrl = (url: string) =>
    app.isPackaged ? url.startsWith("file:") : url.startsWith(devServerUrl);
  window.webContents.session.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      callback(
        webContents.id === window.webContents.id &&
          isTrustedRendererUrl(details.requestingUrl) &&
          (permission === "media" || permission === "display-capture"),
      );
    },
  );
  window.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const requestingUrl = request.frame?.url ?? request.securityOrigin;
      if (!request.frame || !isTrustedRendererUrl(requestingUrl)) {
        log?.("warn", "Blocked screen capture from untrusted frame");
        callback({});
        return;
      }

      const sources = await enumerateScreenCaptureSources(false);
      const primaryDisplayId = String(screen.getPrimaryDisplay().id);
      const selectedSource =
        sources.find((source) => source.id === pendingScreenCaptureSourceId) ??
        sources.find((source) => source.display_id === primaryDisplayId) ??
        sources.find((source) => source.id.startsWith("screen:")) ??
        sources[0];
      pendingScreenCaptureSourceId = undefined;

      if (!selectedSource) {
        log?.("error", "Screen share source enumeration returned no sources");
        callback({});
        return;
      }

      log?.("info", "Approved screen capture request", {
        sourceKind: selectedSource.id.startsWith("screen:") ? "screen" : "window",
        primaryDisplayId,
      });
      callback({
        video: selectedSource,
        audio: process.platform === "win32" ? "loopback" : undefined,
      });
    } catch (error) {
      log?.("error", "Failed to approve screen capture request", {
        error: error instanceof Error ? error.message : String(error),
      });
      callback({});
    }
  });

  window.webContents.once("did-finish-load", () => {
    log?.("info", "Renderer main frame finished load", { targetUrl });
  });

  window.webContents.once("dom-ready", () => {
    log?.("info", "Renderer DOM ready");
  });

  let saveBoundsTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    if (window.isMaximized() || window.isMinimized()) return;
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      try {
        writeFileSync(boundsPath, JSON.stringify(window.getBounds()), "utf8");
      } catch (error) {
        log?.("warn", "Failed to persist window bounds", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 250);
  };
  window.on("resize", saveBounds);
  window.on("move", saveBounds);

  setTimeout(() => {
    if (!window.isVisible()) {
      window.show();
      window.focus();
    }
  }, 1_500);

  void loadRenderer();

  return window;
};
