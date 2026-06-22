import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { app, BrowserWindow, Tray, dialog } from "electron";

import { APP_ID } from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { registerIpcHandlers } from "./ipc";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { SignalingClientBridge } from "./signaling-client";
import { createTrayController } from "./tray";
import { UpdateService } from "./updates";
import { createMainWindow } from "./window";
import { OverlayWindowController } from "./overlay-window";
import { GameDetectionController } from "./game-detection";
import { LlmService } from "./llm-service";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let diagnostics: DiagnosticsService | null = null;
let settingsStore: SettingsStore | null = null;
let shortcutsController: ShortcutController | null = null;
let overlayController: OverlayWindowController | null = null;
let gameDetectionController: GameDetectionController | null = null;

const QUIT_FOR_INSTALL_ARG = "--shanghao-quit-for-install";
const shouldQuitForInstall = process.argv.includes(QUIT_FOR_INSTALL_ARG);

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

const prepareForQuit = (reason: string) => {
  isQuitting = true;
  void diagnostics?.writeLog({
    category: "app",
    level: "info",
    message: "Preparing to quit",
    context: { reason },
  });

  overlayController?.close();
  gameDetectionController?.stop();
  shortcutsController?.dispose();

  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
};

const quitForInstall = (reason: string) => {
  prepareForQuit(reason);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners("close");
    mainWindow.close();
  }
  app.quit();
  setTimeout(() => app.exit(0), 1_500).unref();
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
    "\u8F6F\u4EF6\u542F\u52A8\u5931\u8D25",
    `${"\u4E0A\u53F7\u6CA1\u6709\u6B63\u5E38\u542F\u52A8\u3002"}\n\n${"\u65E5\u5FD7\u76EE\u5F55\uFF1A"}${logsDirectory}\n\n${"\u9519\u8BEF\uFF1A"}${message}\n\n${"\u4F60\u53EF\u4EE5\u91CD\u8BD5\uFF0C\u6216\u8005\u5220\u9664 settings.json \u540E\u518D\u542F\u52A8\u3002"}`,
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

  await sleep(5200);
  if (mode !== "home") {
    await clickButtonByLabel(window, "\u8FDB\u5165\u9891\u9053");
    await sleep(mode === "room" ? 3600 : 700);
  }

  if (mode !== "home") {
    const label =
      mode === "settings"
        ? "\u8BBE\u7F6E"
        : "";

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
  const updates = new UpdateService(
    app.getVersion(),
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
    () => prepareForQuit("auto-update"),
  );
  const shortcuts = new ShortcutController(
    () => mainWindow,
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  await shortcuts.configureGlobalMute(settings.globalMuteShortcut);
  const overlay = new OverlayWindowController();
  const gameDetection = new GameDetectionController(
    (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  );
  gameDetection.start();
  shortcutsController = shortcuts;
  overlayController = overlay;
  gameDetectionController = gameDetection;

  const llm = new LlmService({
    getRelayServerUrl: () => settingsStore?.getSnapshot().relayServerUrl,
    writeLog: (payload) => diagnostics?.writeLog(payload) ?? Promise.resolve(),
  });

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    settingsStore,
    diagnostics,
    shortcuts,
    signalingClient,
    updates,
    overlay,
    gameDetection,
    llm,
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
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  tray = createTrayController(
    () => mainWindow,
    () => prepareForQuit("tray"),
  );

  app.on("before-quit", () => {
    prepareForQuit("before-quit");
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

if (process.platform === "win32") app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch(
  "proxy-bypass-list",
  ".ts.net;100.64.0.0/10;<local>;localhost;127.0.0.1;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*",
);

app.on("second-instance", (_event, commandLine) => {
  if (commandLine.includes(QUIT_FOR_INSTALL_ARG)) {
    quitForInstall("installer-second-instance");
    return;
  }

  showWindow();
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  if (shouldQuitForInstall) {
    setTimeout(() => app.exit(0), 500).unref();
  }
  app.quit();
} else if (shouldQuitForInstall) {
  app.exit(0);
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
