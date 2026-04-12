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

const getBuildAssetPath = (fileName: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, "build", fileName)
    : path.join(app.getAppPath(), "build", fileName);

const getIconPath = () => getBuildAssetPath("icon.ico");

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
      :root { color-scheme: light; font-family: "HarmonyOS Sans", "Segoe UI", system-ui, sans-serif; }
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
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1420,
    minHeight: 900,
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
