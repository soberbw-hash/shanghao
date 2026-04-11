import { ipcMain, shell, type BrowserWindow } from "electron";

import {
  APP_BUILD_NUMBER,
  APP_NAME,
  APP_PROTOCOL_VERSION,
  IPC_CHANNELS,
  type AppSettings,
  type DiagnosticsSnapshot,
  type HostSessionInfo,
  type RecordingExportPayload,
  type RecordingExportResponse,
  type RendererLogPayload,
  type RuntimeInfo,
  type SignalingEventPayload,
  type TailscaleStatus,
} from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { HostSessionController } from "./host-session";
import { exportRecordingFromMain } from "./recording-main";
import { clearAvatarImage, pickAvatarImage, readAvatarImage } from "./profile-media";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { SignalingClientBridge } from "./signaling-client";
import { getNetworkStatusSnapshot, detectProxyDiagnostics } from "./network-diagnostics";
import { detectTailscaleStatus, openTailscaleInstallGuide } from "./tailscale";

interface MainProcessServices {
  getMainWindow: () => BrowserWindow | null;
  settingsStore: SettingsStore;
  diagnostics: DiagnosticsService;
  shortcuts: ShortcutController;
  hostSession: HostSessionController;
  signalingClient: SignalingClientBridge;
}

export const registerIpcHandlers = ({
  getMainWindow,
  settingsStore,
  diagnostics,
  shortcuts,
  hostSession,
  signalingClient,
}: MainProcessServices): void => {
  signalingClient.on("event", (payload: SignalingEventPayload) => {
    getMainWindow()?.webContents.send(IPC_CHANNELS.signaling.event, payload);
  });

  ipcMain.handle(
    IPC_CHANNELS.app.getRuntimeInfo,
    async (): Promise<RuntimeInfo> => ({
      appName: APP_NAME,
      version: process.env.npm_package_version ?? "0.1.5",
      platform: process.platform,
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.app.writeLog,
    async (_event, payload: RendererLogPayload): Promise<void> => {
      await diagnostics.writeLog(payload);
    },
  );

  ipcMain.handle(IPC_CHANNELS.app.openPath, async (_event, targetPath: string): Promise<void> => {
    await shell.openPath(targetPath);
  });

  ipcMain.handle(IPC_CHANNELS.window.minimize, async (): Promise<void> => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.window.hide, async (): Promise<void> => {
    getMainWindow()?.hide();
  });

  ipcMain.handle(IPC_CHANNELS.window.close, async (): Promise<void> => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IPC_CHANNELS.window.show, async (): Promise<void> => {
    const window = getMainWindow();
    if (!window) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  });

  ipcMain.handle(IPC_CHANNELS.settings.get, async (): Promise<AppSettings> => {
    return settingsStore.getSnapshot();
  });

  ipcMain.handle(
    IPC_CHANNELS.settings.save,
    async (_event, partial: Partial<AppSettings>): Promise<AppSettings> => {
      const settings = await settingsStore.save(partial);
      const registered = await shortcuts.configureGlobalMute(settings.globalMuteShortcut);
      if (!registered && settings.globalMuteShortcut) {
        return settingsStore.save({ globalMuteShortcut: "" });
      }
      return settings;
    },
  );

  ipcMain.handle(IPC_CHANNELS.settings.reset, async (): Promise<AppSettings> => {
    const settings = await settingsStore.reset();
    await shortcuts.configureGlobalMute(settings.globalMuteShortcut);
    return settings;
  });

  ipcMain.handle(IPC_CHANNELS.profile.pickAvatar, async () => {
    return pickAvatarImage(settingsStore.getSnapshot().avatarPath);
  });

  ipcMain.handle(IPC_CHANNELS.profile.readAvatar, async (_event, avatarPath?: string) => {
    return readAvatarImage(avatarPath);
  });

  ipcMain.handle(IPC_CHANNELS.profile.clearAvatar, async (_event, avatarPath?: string) => {
    await clearAvatarImage(avatarPath ?? settingsStore.getSnapshot().avatarPath);
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
    IPC_CHANNELS.diagnostics.exportBundle,
    async (): Promise<DiagnosticsSnapshot> => {
      const settings = settingsStore.getSnapshot();
      const network = await getNetworkStatusSnapshot();
      return diagnostics.exportBundle([
        { name: "settings.json", content: JSON.stringify(settings, null, 2) },
        { name: "network.json", content: JSON.stringify(network, null, 2) },
      ]);
    },
  );

  ipcMain.handle(IPC_CHANNELS.diagnostics.openLogsDirectory, async (): Promise<void> => {
    await diagnostics.openLogsDirectory();
  });

  ipcMain.handle(
    IPC_CHANNELS.shortcuts.configureMute,
    async (_event, accelerator: string): Promise<void> => {
      await shortcuts.configureGlobalMute(accelerator);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.tailscale.checkStatus,
    async (): Promise<TailscaleStatus> => detectTailscaleStatus(),
  );

  ipcMain.handle(IPC_CHANNELS.tailscale.openInstallGuide, async (): Promise<void> => {
    await openTailscaleInstallGuide();
  });

  ipcMain.handle(IPC_CHANNELS.network.getSnapshot, async () => {
    return getNetworkStatusSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.network.getProxyDiagnostics, async () => {
    return detectProxyDiagnostics();
  });

  ipcMain.handle(
    IPC_CHANNELS.host.start,
    async (
      _event,
      roomName: string,
      nickname: string,
      connectionMode: AppSettings["connectionMode"],
    ): Promise<HostSessionInfo> => {
      return hostSession.start(roomName, nickname, connectionMode);
    },
  );

  ipcMain.handle(IPC_CHANNELS.host.stop, async (): Promise<void> => {
    await hostSession.stop();
  });

  ipcMain.handle(
    IPC_CHANNELS.host.diagnoseJoin,
    async (_event, signalingUrl: string, connectionMode: AppSettings["connectionMode"]) => {
      return hostSession.diagnoseJoin(signalingUrl, connectionMode);
    },
  );

  ipcMain.handle(IPC_CHANNELS.signaling.connect, async (_event, signalingUrl: string) => {
    await signalingClient.connect(signalingUrl);
  });

  ipcMain.handle(IPC_CHANNELS.signaling.send, async (_event, payload: string) => {
    await signalingClient.send(payload);
  });

  ipcMain.handle(IPC_CHANNELS.signaling.close, async () => {
    await signalingClient.close();
  });

  ipcMain.handle(
    IPC_CHANNELS.recording.export,
    async (_event, payload: RecordingExportPayload): Promise<RecordingExportResponse> => {
      return exportRecordingFromMain(payload, (logPayload) => diagnostics.writeLog(logPayload));
    },
  );
};
