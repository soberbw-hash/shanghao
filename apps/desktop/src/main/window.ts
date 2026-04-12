import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow } from "electron";

import { APP_ID, APP_NAME } from "@private-voice/shared";

const devServerUrl = "http://127.0.0.1:5173";

interface CreateMainWindowOptions {
  log?: (
    level: "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ) => void;
  logsDirectory?: string;
}

const getIconPath = () => path.join(app.getAppPath(), "build", "icon.ico");

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
      :root { color-scheme: light; font-family: "HarmonyOS Sans","Segoe UI",system-ui,sans-serif; }
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
      ${logsDirectory ? `<code>日志目录：${logsDirectory}</code>` : ""}
    </div>
  </body>
</html>`;

export const createMainWindow = ({
  log,
  logsDirectory,
}: CreateMainWindowOptions = {}): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1280,
    minHeight: 820,
    backgroundColor: "#F5F7FA",
    frame: false,
    titleBarStyle: "hidden",
    title: APP_NAME,
    show: false,
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.setAppDetails({ appId: APP_ID, appIconPath: getIconPath() });

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
      await loadFallback("软件启动失败", "上号没有顺利打开界面，请查看日志后重试。", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  window.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || hasShownFallback) {
        return;
      }

      void loadFallback("界面加载失败", "上号没有顺利加载主界面，请稍后重试。", {
        errorCode,
        errorDescription,
        validatedURL,
        targetUrl,
      });
    },
  );

  window.webContents.on("render-process-gone", (_event, details) => {
    void loadFallback("界面意外退出", "渲染进程已经退出，请根据日志检查启动问题。", {
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

  window.webContents.setWindowOpenHandler(({ url }) => {
    log?.("warn", "Blocked unexpected window open", { url });
    return { action: "deny" };
  });

  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });

  window.webContents.once("did-finish-load", () => {
    log?.("info", "Renderer main frame finished load", { targetUrl });
  });

  window.webContents.once("dom-ready", () => {
    log?.("info", "Renderer DOM ready");
  });

  setTimeout(() => {
    if (!window.isVisible()) {
      window.show();
      window.focus();
    }
  }, 1_500);

  void loadRenderer();

  return window;
};
