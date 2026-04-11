import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { app, BrowserWindow, Tray } from "electron";

import { DiagnosticsService } from "./diagnostics";
import { HostSessionController } from "./host-session";
import { registerIpcHandlers } from "./ipc";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { createTrayController } from "./tray";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  const diagnostics = new DiagnosticsService();
  await diagnostics.init();
  await diagnostics.writeLog({
    category: "app",
    level: "info",
    message: "Main process bootstrap started",
  });

  process.on("uncaughtException", (error) => {
    void diagnostics.writeLog({
      category: "app",
      level: "error",
      message: "Main process uncaught exception",
      context: {
        error: error.message,
        stack: error.stack,
      },
    });
  });

  process.on("unhandledRejection", (reason) => {
    void diagnostics.writeLog({
      category: "app",
      level: "error",
      message: "Main process unhandled rejection",
      context: {
        reason: reason instanceof Error ? reason.message : String(reason),
      },
    });
  });

  const settingsStore = new SettingsStore((payload) => diagnostics.writeLog(payload));
  const settings = await settingsStore.load();

  const hostSession = new HostSessionController((payload) => diagnostics.writeLog(payload));
  const shortcuts = new ShortcutController(() => mainWindow);
  shortcuts.configureGlobalMute(settings.globalMuteShortcut);

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    settingsStore,
    diagnostics,
    shortcuts,
    hostSession,
  });

  mainWindow = createMainWindow({
    log: (level, message, context) => {
      void diagnostics.writeLog({
        category: "app",
        level,
        message,
        context,
      });
    },
  });
  await diagnostics.writeLog({
    category: "app",
    level: "info",
    message: "Main window created",
  });
  void maybeCaptureScreenshot(mainWindow);

  mainWindow.on("close", (event) => {
    if (!isQuitting && settingsStore.getSnapshot().minimizeToTray) {
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
          void diagnostics.writeLog({
            category: "app",
            level,
            message,
            context,
          });
        },
      });
      return;
    }

    mainWindow.show();
    mainWindow.focus();
  });
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void app.whenReady().then(bootstrap);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
