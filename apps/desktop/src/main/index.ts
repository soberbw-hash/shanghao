import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { app, BrowserWindow, Tray, dialog } from "electron";

import { APP_ID } from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { HostSessionController } from "./host-session";
import { registerIpcHandlers } from "./ipc";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { SignalingClientBridge } from "./signaling-client";
import { createTrayController } from "./tray";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let diagnostics: DiagnosticsService | null = null;
let settingsStore: SettingsStore | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const showWindow = () => {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
};

const showBootstrapError = async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const logsDirectory = diagnostics?.getSnapshot().logsDirectory ?? app.getPath("userData");

  await diagnostics?.writeLog({
    category: "app",
    level: "error",
    message: "Software bootstrap failed",
    context: { error: message, logsDirectory },
  });

  dialog.showErrorBox(
    "软件启动失败",
    `上号没有正常启动。\n\n日志目录：${logsDirectory}\n\n错误：${message}\n\n你可以重试，或者删除 settings.json 后再启动。`,
  );

  if (!mainWindow) {
    mainWindow = createMainWindow({
      log: (level, entry, context) => {
        void diagnostics?.writeLog({
          category: "app",
          level,
          message: entry,
          context,
        });
      },
      logsDirectory,
    });
  }

  showWindow();
};

const clickButtonByLabel = async (
  window: BrowserWindow,
  label: string,
): Promise<boolean> => {
  return window.webContents.executeJavaScript(
    `
      (() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const target = buttons.find((button) =>
          (button.textContent || "").replace(/\\s+/g, " ").includes(${JSON.stringify(label)}),
        );
        if (target instanceof HTMLButtonElement) {
          target.click();
          return true;
        }
        return false;
      })();
    `,
    true,
  );
};

const maybeCaptureScreenshot = async (window: BrowserWindow | null): Promise<void> => {
  const outputPath = process.env.SHANGHAO_CAPTURE_PATH;
  const mode = process.env.SHANGHAO_CAPTURE_MODE ?? "home";

  if (!window || !outputPath) {
    return;
  }

  if (window.webContents.isLoadingMainFrame()) {
    await new Promise<void>((resolve) => {
      window.webContents.once("did-finish-load", () => resolve());
    });
  }

  await sleep(1800);
  await clickButtonByLabel(window, "进入上号");
  await sleep(500);

  if (mode !== "home") {
    const label = mode === "settings" ? "设置" : mode === "room" ? "开启房间" : "";

    if (label) {
      await clickButtonByLabel(window, label);
      await sleep(mode === "room" ? 2400 : 900);
    }
  }

  const image = await window.capturePage();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, image.toPNG());

  if (process.env.SHANGHAO_CAPTURE_EXIT !== "0") {
    isQuitting = true;
    app.quit();
  }
};

const bootstrap = async (): Promise<void> => {
  diagnostics = new DiagnosticsService();
  await diagnostics.init();
  await diagnostics.writeLog({
    category: "app",
    level: "info",
    message: "Main process bootstrap started",
  });

  settingsStore = new SettingsStore((payload) => diagnostics?.writeLog(payload) ?? Promise.resolve());
  const settings = await settingsStore.load();

  const signalingClient = new SignalingClientBridge(
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  const hostSession = new HostSessionController(
    () => settingsStore?.getSnapshot() ?? settings,
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  const shortcuts = new ShortcutController(
    () => mainWindow,
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  await shortcuts.configureGlobalMute(settings.globalMuteShortcut);

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    settingsStore,
    diagnostics,
    shortcuts,
    hostSession,
    signalingClient,
  });

  mainWindow = createMainWindow({
    log: (level, message, context) => {
      void diagnostics?.writeLog({
        category: "app",
        level,
        message,
        context,
      });
    },
    logsDirectory: diagnostics.getSnapshot().logsDirectory,
  });

  await diagnostics.writeLog({
    category: "app",
    level: "info",
    message: "Main window created",
  });
  void maybeCaptureScreenshot(mainWindow);

  mainWindow.on("close", (event) => {
    if (!isQuitting && settingsStore?.getSnapshot().minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  tray = createTrayController(
    () => mainWindow,
    () => {
      isQuitting = true;
      shortcuts.dispose();
    },
  );

  app.on("before-quit", () => {
    isQuitting = true;
    shortcuts.dispose();
  });

  app.on("activate", () => {
    if (!mainWindow) {
      mainWindow = createMainWindow({
        log: (level, message, context) => {
          void diagnostics?.writeLog({
            category: "app",
            level,
            message,
            context,
          });
        },
        logsDirectory: diagnostics?.getSnapshot().logsDirectory,
      });
      return;
    }

    showWindow();
  });
};

app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch(
  "proxy-bypass-list",
  ".ts.net;100.64.0.0/10;<local>;localhost;127.0.0.1;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*",
);

app.on("second-instance", () => {
  showWindow();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app
    .whenReady()
    .then(bootstrap)
    .catch(async (error) => {
      await showBootstrapError(error);
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
