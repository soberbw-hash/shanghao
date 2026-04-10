import { ipcMain, shell, type BrowserWindow } from "electron";

import {
  APP_NAME,
  IPC_CHANNELS,
  type AppSettings,
  type DesktopApi,
  type DiagnosticsSnapshot,
  type HostSessionInfo,
  type RecordingExportPayload,
  type RecordingExportResponse,
  type RendererLogPayload,
  type RuntimeInfo,
  type TailscaleStatus,
} from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { HostSessionController } from "./host-session";
import { exportRecordingFromMain } from "./recording-main";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { detectTailscaleStatus, openTailscaleInstallGuide } from "./tailscale";

interface MainProcessServices {
  getMainWindow: () => BrowserWindow | null;
  settingsStore: SettingsStore;
  diagnostics: DiagnosticsService;
  shortcuts: ShortcutController;
  hostSession: HostSessionController;
}

export const registerIpcHandlers = ({
  getMainWindow,
  settingsStore,
  diagnostics,
  shortcuts,
  hostSession,
}: MainProcessServices): void => {
  ipcMain.handle(
    IPC_CHANNELS.app.getRuntimeInfo,
    async (): Promise<RuntimeInfo> => ({
      appName: APP_NAME,
      version: process.env.npm_package_version ?? "0.1.0",
      platform: process.platform,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.app.writeLog,
    async (_event, payload: RendererLogPayload): Promise<void> => {
      await diagnostics.writeLog(payload);
    },
  );

  ipcMain.handle(IPC_CHANNELS.window.minimize, async (): Promise<void> => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.window.hide, async (): Promise<void> => {
    getMainWindow()?.hide();
  });

  ipcMain.handle(IPC_CHANNELS.window.close, async (): Promise<void> => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IPC_CHANNELS.settings.get, async (): Promise<AppSettings> => {
    return settingsStore.getSnapshot();
  });

  ipcMain.handle(
    IPC_CHANNELS.settings.save,
    async (_event, partial: Partial<AppSettings>): Promise<AppSettings> => {
      const settings = await settingsStore.save(partial);
      shortcuts.configureGlobalMute(settings.globalMuteShortcut);
      return settings;
    },
  );

  ipcMain.handle(IPC_CHANNELS.settings.reset, async (): Promise<AppSettings> => {
    const settings = await settingsStore.reset();
    shortcuts.configureGlobalMute(settings.globalMuteShortcut);
    return settings;
  });

  ipcMain.handle(
    IPC_CHANNELS.diagnostics.snapshot,
    async (): Promise<DiagnosticsSnapshot> => diagnostics.getSnapshot(),
  );

  ipcMain.handle(
    IPC_CHANNELS.diagnostics.exportLogs,
    async (): Promise<DiagnosticsSnapshot> => diagnostics.exportLogs(),
  );

  ipcMain.handle(
    IPC_CHANNELS.shortcuts.configureMute,
    async (_event, accelerator: string): Promise<void> => {
      shortcuts.configureGlobalMute(accelerator);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.tailscale.checkStatus,
    async (): Promise<TailscaleStatus> => detectTailscaleStatus(),
  );

  ipcMain.handle(IPC_CHANNELS.tailscale.openInstallGuide, async (): Promise<void> => {
    await openTailscaleInstallGuide();
  });

  ipcMain.handle(
    IPC_CHANNELS.host.start,
    async (_event, roomName: string, nickname: string): Promise<HostSessionInfo> => {
      return hostSession.start(roomName, nickname);
    },
  );

  ipcMain.handle(IPC_CHANNELS.host.stop, async (): Promise<void> => {
    await hostSession.stop();
  });

  ipcMain.handle(
    IPC_CHANNELS.recording.export,
    async (_event, payload: RecordingExportPayload): Promise<RecordingExportResponse> => {
      return exportRecordingFromMain(payload, (logPayload) => diagnostics.writeLog(logPayload));
    },
  );

  ipcMain.handle("app:open-url", async (_event, url: string): Promise<void> => {
    await shell.openExternal(url);
  });
};
