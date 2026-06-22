import { app, clipboard, ipcMain, shell, type BrowserWindow } from "electron";

import {
  APP_BUILD_NUMBER,
  APP_NAME,
  APP_PROTOCOL_VERSION,
  IPC_CHANNELS,
  type AppSettings,
  type DiagnosticsSnapshot,
  type GameDetectionSnapshot,
  type LlmChatRequest,
  type LlmChatResponse,
  type OverlayState,
  type RecordingExportPayload,
  type RecordingExportResponse,
  type RendererLogPayload,
  type RuntimeInfo,
  type SignalingEventPayload,
  type UpdateCheckResult,
  type UpdateStatus,
} from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { LlmService } from "./llm-service";
import { clearAvatarImage, pickAvatarImage, readAvatarImage } from "./profile-media";
import { exportRecordingFromMain } from "./recording-main";
import { readRelayStatus } from "./relay-status";
import { sendToWindow } from "./safe-web-contents";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { SignalingClientBridge } from "./signaling-client";
import { UpdateService } from "./updates";
import { OverlayWindowController } from "./overlay-window";
import { GameDetectionController } from "./game-detection";

interface MainProcessServices {
  getMainWindow: () => BrowserWindow | null;
  settingsStore: SettingsStore;
  diagnostics: DiagnosticsService;
  shortcuts: ShortcutController;
  signalingClient: SignalingClientBridge;
  updates: UpdateService;
  overlay: OverlayWindowController;
  gameDetection: GameDetectionController;
  llm: LlmService;
}

export const registerIpcHandlers = ({
  getMainWindow,
  settingsStore,
  diagnostics,
  shortcuts,
  signalingClient,
  updates,
  overlay,
  gameDetection,
  llm,
}: MainProcessServices): void => {
  signalingClient.on("event", (payload: SignalingEventPayload) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.signaling.event, payload);
  });
  updates.onStatus((status: UpdateStatus) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.updates.status, status);
  });
  gameDetection.onDetected((snapshot) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.games.detected, snapshot);
  });

  ipcMain.handle(
    IPC_CHANNELS.app.getRuntimeInfo,
    async (): Promise<RuntimeInfo> => ({
      appName: APP_NAME,
      version: app.getVersion(),
      platform: process.platform,
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
  );

  ipcMain.handle(IPC_CHANNELS.app.writeLog, async (_event, payload: RendererLogPayload): Promise<void> => {
    await diagnostics.writeLog(payload);
  });

  ipcMain.handle(IPC_CHANNELS.app.openPath, async (_event, targetPath: string): Promise<void> => {
    await shell.openPath(targetPath);
  });

  ipcMain.handle(IPC_CHANNELS.clipboard.writeText, async (_event, text: string): Promise<void> => {
    clipboard.writeText(text);
    await diagnostics.writeLog({
      category: "app",
      level: "info",
      message: "Copied text through native clipboard",
      context: { length: text.length },
    });
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

  ipcMain.handle(IPC_CHANNELS.settings.get, async (): Promise<AppSettings> => settingsStore.getSnapshot());

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

  ipcMain.handle(IPC_CHANNELS.profile.pickAvatar, async () => pickAvatarImage(settingsStore.getSnapshot().avatarPath));
  ipcMain.handle(IPC_CHANNELS.profile.readAvatar, async (_event, avatarPath?: string) => readAvatarImage(avatarPath));
  ipcMain.handle(IPC_CHANNELS.profile.clearAvatar, async (_event, avatarPath?: string) => {
    await clearAvatarImage(avatarPath ?? settingsStore.getSnapshot().avatarPath);
  });

  ipcMain.handle(IPC_CHANNELS.diagnostics.snapshot, async (): Promise<DiagnosticsSnapshot> => diagnostics.getSnapshot());
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportLogs, async (): Promise<DiagnosticsSnapshot> => diagnostics.exportLogs());

  ipcMain.handle(IPC_CHANNELS.diagnostics.exportBundle, async (_event, rendererState): Promise<DiagnosticsSnapshot> => {
    const settings = settingsStore.getSnapshot();
    const relay = await readRelayStatus({
      relayServerUrl: settings.relayServerUrl,
      writeLog: (payload) => diagnostics.writeLog(payload),
    });
    const summary = {
      appVersion: app.getVersion(),
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      serverUrl: settings.relayServerUrl,
      currentRoomId: rendererState?.currentRoomId,
      currentPeerId: rendererState?.currentPeerId,
      relay,
      exportedAt: new Date().toISOString(),
    };

    return diagnostics.exportBundle([
      { name: "settings.json", content: JSON.stringify(settings, null, 2) },
      { name: "relay.json", content: JSON.stringify(relay, null, 2) },
      { name: "summary.json", content: JSON.stringify(summary, null, 2) },
      {
        name: "renderer-session.json",
        content: JSON.stringify(rendererState ?? null, null, 2),
      },
      {
        name: "audio-timeline.json",
        content: JSON.stringify(rendererState?.audioTimeline ?? [], null, 2),
      },
    ]);
  });

  ipcMain.handle(IPC_CHANNELS.diagnostics.openLogsDirectory, async (): Promise<void> => {
    await diagnostics.openLogsDirectory();
  });

  ipcMain.handle(IPC_CHANNELS.shortcuts.configureMute, async (_event, accelerator: string): Promise<void> => {
    await shortcuts.configureGlobalMute(accelerator);
  });

  ipcMain.handle(IPC_CHANNELS.updates.check, async (): Promise<UpdateCheckResult> => {
    const result = await updates.check();
    diagnostics.setLastUpdateCheckMessage(result.message);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.updates.openReleases, async (): Promise<void> => {
    await updates.openReleases();
  });

  ipcMain.handle(IPC_CHANNELS.overlay.toggle, async (): Promise<boolean> => overlay.toggle());
  ipcMain.handle(IPC_CHANNELS.overlay.close, async (): Promise<void> => overlay.close());
  ipcMain.handle(IPC_CHANNELS.overlay.update, async (_event, state: OverlayState): Promise<void> => {
    overlay.update(state);
  });
  ipcMain.handle(
    IPC_CHANNELS.games.getSnapshot,
    async (): Promise<GameDetectionSnapshot> => gameDetection.getSnapshot(),
  );
  ipcMain.handle(IPC_CHANNELS.updates.download, async (): Promise<void> => {
    await updates.download();
  });
  ipcMain.handle(IPC_CHANNELS.updates.install, async (): Promise<void> => {
    updates.install();
  });

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
    async (_event, payload: RecordingExportPayload): Promise<RecordingExportResponse> =>
      exportRecordingFromMain(payload, (logPayload) => diagnostics.writeLog(logPayload)),
  );

  ipcMain.handle(
    IPC_CHANNELS.llm.chat,
    async (_event, payload: LlmChatRequest): Promise<LlmChatResponse> => llm.chat(payload),
  );

  ipcMain.handle(
    IPC_CHANNELS.llm.health,
    async () => llm.health(),
  );
};
