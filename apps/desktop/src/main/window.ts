import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow } from "electron";
import { APP_NAME } from "@private-voice/shared";

const devServerUrl = "http://127.0.0.1:5173";

interface CreateMainWindowOptions {
  log?: (level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
}

const createFallbackHtml = (title: string, description: string) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${APP_NAME}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f5f7fa;
        color: #111827;
      }
      .card {
        width: min(520px, calc(100vw - 32px));
        border: 1px solid #e7ecf2;
        border-radius: 24px;
        background: #ffffff;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(17, 24, 39, 0.08);
      }
      h1 {
        margin: 0;
        font-size: 26px;
      }
      p {
        margin: 12px 0 0;
        font-size: 14px;
        line-height: 1.7;
        color: #667085;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${description}</p>
    </div>
  </body>
</html>`;

export const createMainWindow = ({ log }: CreateMainWindowOptions = {}): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#F5F7FA",
    frame: false,
    titleBarStyle: "hidden",
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const targetUrl = !app.isPackaged
    ? devServerUrl
    : pathToFileURL(path.join(__dirname, "../../dist/index.html")).toString();

  let hasShownFallback = false;

  const loadFallback = async (title: string, description: string, context?: Record<string, unknown>) => {
    if (hasShownFallback) {
      return;
    }

    hasShownFallback = true;
    log?.("error", title, context);
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createFallbackHtml(title, description))}`);
    window.show();
  };

  const loadRenderer = async () => {
    try {
      if (!app.isPackaged) {
        await window.loadURL(devServerUrl);
      } else {
        await window.loadFile(path.join(__dirname, "../../dist/index.html"));
      }
    } catch (error) {
      await loadFallback("界面加载失败", "上号没有顺利打开界面，请重试或重新安装。", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || hasShownFallback) {
      return;
    }

    void loadFallback("界面加载失败", "上号没有顺利加载主界面，请稍后重试。", {
      errorCode,
      errorDescription,
      validatedURL,
      targetUrl,
    });
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    void loadFallback("界面意外退出", "渲染进程已经退出，上号没法继续显示主界面。", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  window.webContents.on("unresponsive", () => {
    log?.("warn", "Renderer became unresponsive");
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.setBackgroundColor("#F5F7FA");
  window.webContents.setWindowOpenHandler(({ url }) => {
    log?.("warn", "Blocked unexpected window open", { url });
    return { action: "deny" };
  });

  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });

  window.setTitle(APP_NAME);
  window.webContents.once("did-finish-load", () => {
    log?.("info", "Renderer main frame finished load", { targetUrl });
  });

  window.webContents.once("dom-ready", () => {
    log?.("info", "Renderer DOM ready");
  });

  setTimeout(() => {
    if (!window.isVisible()) {
      window.show();
    }
  }, 1_500);

  void loadRenderer();

  return window;
};
