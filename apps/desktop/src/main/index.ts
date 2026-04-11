import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { app, type BrowserWindow, Tray } from "electron";

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
  await clickButtonByLabel(window, "开始使用");
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
  const settingsStore = new SettingsStore();
  const settings = await settingsStore.load();

  const diagnostics = new DiagnosticsService();
  await diagnostics.init();

  const hostSession = new HostSessionController((payload) => diagnostics.writeLog(payload));

  mainWindow = createMainWindow();
  void maybeCaptureScreenshot(mainWindow);

  mainWindow.on("close", (event) => {
    if (!isQuitting && settingsStore.getSnapshot().minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  const shortcuts = new ShortcutController(() => mainWindow);
  shortcuts.configureGlobalMute(settings.globalMuteShortcut);

  tray = createTrayController(
    () => mainWindow,
    () => {
      isQuitting = true;
      shortcuts.dispose();
    },
  );

  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    settingsStore,
    diagnostics,
    shortcuts,
    hostSession,
  });

  app.on("before-quit", () => {
    isQuitting = true;
    shortcuts.dispose();
  });

  app.on("activate", () => {
    if (!mainWindow) {
      mainWindow = createMainWindow();
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
