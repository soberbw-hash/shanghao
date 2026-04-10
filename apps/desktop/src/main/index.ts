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

const bootstrap = async (): Promise<void> => {
  const settingsStore = new SettingsStore();
  const settings = await settingsStore.load();

  const diagnostics = new DiagnosticsService();
  await diagnostics.init();

  const hostSession = new HostSessionController((payload) => diagnostics.writeLog(payload));

  mainWindow = createMainWindow();

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
