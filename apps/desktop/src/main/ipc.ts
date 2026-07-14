import { app, clipboard, ipcMain, Notification, powerMonitor, type BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  APP_BUILD_NUMBER,
  APP_NAME,
  APP_PROTOCOL_VERSION,
  IPC_CHANNELS,
  type AppSettings,
  type DiagnosticsSnapshot,
  type GameDetectionSnapshot,
  type OverlayState,
  type RelayStatusSnapshot,
  type RecordingExportPayload,
  type RecordingExportResponse,
  type RecordingMarker,
  type RendererLogPayload,
  type RuntimeInfo,
  type ScreenShareViewerFrame,
  type SignalingEventPayload,
  type UpdateCheckResult,
  type UpdateStatus,
} from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
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
import { applyLaunchOnStartup } from "./launch-on-startup";
import {
  closeScreenShareViewer,
  listScreenCaptureSources,
  openScreenShareViewer,
  selectScreenCaptureSource,
  updateScreenShareViewer,
} from "./window";

interface MainProcessServices {
  getMainWindow: () => BrowserWindow | null;
  settingsStore: SettingsStore;
  diagnostics: DiagnosticsService;
  shortcuts: ShortcutController;
  signalingClient: SignalingClientBridge;
  updates: UpdateService;
  overlay: OverlayWindowController;
  gameDetection: GameDetectionController;
}

const requireString = (value: unknown, maximumLength: number, label: string): string => {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`invalid_${label}`);
  }
  return value;
};

const sanitizeServerUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
};

export const registerIpcHandlers = ({
  getMainWindow,
  settingsStore,
  diagnostics,
  shortcuts,
  signalingClient,
  updates,
  overlay,
  gameDetection,
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

  ipcMain.handle(IPC_CHANNELS.app.getRuntimeInfo, async (): Promise<RuntimeInfo> => ({
    appName: APP_NAME,
    version: app.getVersion(),
    platform: process.platform,
    protocolVersion: APP_PROTOCOL_VERSION,
    buildNumber: APP_BUILD_NUMBER,
  }));

  ipcMain.handle(IPC_CHANNELS.app.getSystemIdleSeconds, async (): Promise<number> =>
    Math.max(0, powerMonitor.getSystemIdleTime()),
  );

  ipcMain.handle(
    IPC_CHANNELS.app.writeLog,
    async (_event, payload: RendererLogPayload): Promise<void> => {
      if (!payload || typeof payload !== "object") throw new Error("invalid_log_payload");
      requireString(payload.message, 500, "log_message");
      await diagnostics.writeLog(payload);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.app.notify,
    async (_event, payload: { title: string; body: string }): Promise<void> => {
      requireString(payload?.title, 80, "notification_title");
      requireString(payload?.body, 180, "notification_body");
      if (!Notification.isSupported()) {
        return;
      }
      const notification = new Notification({
        title: payload.title.slice(0, 80),
        body: payload.body.slice(0, 180),
        silent: true,
      });
      notification.on("click", () => {
        const mainWindow = getMainWindow();
        if (mainWindow?.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow?.show();
        mainWindow?.focus();
      });
      notification.show();
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.shortcuts.configureRecordingMarker,
    async (_event, accelerator: string): Promise<boolean> =>
      shortcuts.configureRecordingMarker(accelerator),
  );

  ipcMain.handle(IPC_CHANNELS.clipboard.writeText, async (_event, text: string): Promise<void> => {
    requireString(text, 4_096, "clipboard_text");
    clipboard.writeText(text);
    await diagnostics.writeLog({
      category: "app",
      level: "info",
      message: "Copied text through native clipboard",
      context: { length: text.length },
    });
  });

  ipcMain.handle(IPC_CHANNELS.screenCapture.listSources, async () => listScreenCaptureSources());
  ipcMain.handle(
    IPC_CHANNELS.screenCapture.selectSource,
    async (_event, sourceId: unknown): Promise<void> => {
      selectScreenCaptureSource(requireString(sourceId, 256, "screen_source_id"));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.screenShareViewer.open,
    async (_event, title: unknown): Promise<void> =>
      openScreenShareViewer(requireString(title, 160, "screen_viewer_title")),
  );
  ipcMain.handle(
    IPC_CHANNELS.screenShareViewer.updateFrame,
    async (_event, frame: ScreenShareViewerFrame): Promise<boolean> => {
      if (!frame || typeof frame !== "object") throw new Error("invalid_screen_viewer_frame");
      return updateScreenShareViewer({
        title: requireString(frame.title, 160, "screen_viewer_title"),
        dataUrl: requireString(frame.dataUrl, 8 * 1024 * 1024, "screen_viewer_frame"),
      });
    },
  );
  ipcMain.handle(IPC_CHANNELS.screenShareViewer.close, async (): Promise<void> => {
    closeScreenShareViewer();
  });

  ipcMain.handle(IPC_CHANNELS.window.minimize, async (): Promise<void> => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.window.toggleMaximize, async (): Promise<boolean> => {
    const window = getMainWindow();
    if (!window) return false;
    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }
    window.maximize();
    return true;
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

  ipcMain.handle(IPC_CHANNELS.settings.get, async (): Promise<AppSettings> =>
    settingsStore.getSnapshot(),
  );

  ipcMain.handle(
    IPC_CHANNELS.settings.save,
    async (_event, partial: Partial<AppSettings>): Promise<AppSettings> => {
      if (
        !partial ||
        typeof partial !== "object" ||
        Array.isArray(partial) ||
        JSON.stringify(partial).length > 32_768
      ) {
        throw new Error("invalid_settings_patch");
      }
      if (typeof partial.launchOnStartup === "boolean") {
        try {
          applyLaunchOnStartup(partial.launchOnStartup);
        } catch (error) {
          await diagnostics.writeLog({
            category: "app",
            level: "error",
            message: "launch on startup setup failed",
            context: { error: error instanceof Error ? error.message : String(error) },
          });
          throw new Error("无法设置开机启动，请检查 Windows 启动应用权限。", {
            cause: error,
          });
        }
      }
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

  ipcMain.handle(IPC_CHANNELS.profile.pickAvatar, async () =>
    pickAvatarImage(settingsStore.getSnapshot().avatarPath),
  );
  ipcMain.handle(IPC_CHANNELS.profile.readAvatar, async (_event, avatarPath?: string) =>
    readAvatarImage(avatarPath),
  );
  ipcMain.handle(IPC_CHANNELS.profile.clearAvatar, async (_event, avatarPath?: string) => {
    await clearAvatarImage(avatarPath ?? settingsStore.getSnapshot().avatarPath);
  });

  ipcMain.handle(IPC_CHANNELS.diagnostics.snapshot, async (): Promise<DiagnosticsSnapshot> =>
    diagnostics.getSnapshot(),
  );
  ipcMain.handle(
    IPC_CHANNELS.diagnostics.testServer,
    async (_event, serverUrl: unknown): Promise<RelayStatusSnapshot> => {
      if (typeof serverUrl !== "string" || serverUrl.length > 2_048) {
        throw new Error("invalid_server_url");
      }
      return readRelayStatus({
        relayServerUrl: serverUrl,
        writeLog: (payload) => diagnostics.writeLog(payload),
      });
    },
  );
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportLogs, async (): Promise<DiagnosticsSnapshot> =>
    diagnostics.exportLogs(),
  );

  ipcMain.handle(
    IPC_CHANNELS.diagnostics.exportBundle,
    async (_event, rendererState): Promise<DiagnosticsSnapshot> => {
      const settings = settingsStore.getSnapshot();
      const relay = await readRelayStatus({
        relayServerUrl: settings.relayServerUrl,
        writeLog: (payload) => diagnostics.writeLog(payload),
      });
      const safeServerUrl = sanitizeServerUrl(settings.relayServerUrl);
      const safeRelay = { ...relay, serverUrl: sanitizeServerUrl(relay.serverUrl) };
      const settingsSummary = {
        settingsSchemaVersion: settings.settingsSchemaVersion,
        profileSchemaVersion: settings.profileSchemaVersion,
        profileReady: settings.hasCompletedProfileSetup,
        preferredSampleRate: settings.preferredSampleRate,
        lowCutFrequency: settings.lowCutFrequency,
        micEqualizerGains: settings.micEqualizerGains,
        inputLevelThreshold: settings.inputLevelThreshold,
        isNoiseSuppressionEnabled: settings.isNoiseSuppressionEnabled,
        isEchoCancellationEnabled: settings.isEchoCancellationEnabled,
        isAutoGainControlEnabled: settings.isAutoGainControlEnabled,
        isPushToTalkEnabled: settings.isPushToTalkEnabled,
        isOverlayEnabled: settings.isOverlayEnabled,
        serverUrl: safeServerUrl,
      };
      const safeRendererState = rendererState
        ? { ...rendererState, serverUrl: sanitizeServerUrl(rendererState.serverUrl) }
        : null;
      const summary = {
        appVersion: app.getVersion(),
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
        serverUrl: safeServerUrl,
        currentRoomId: rendererState?.currentRoomId,
        currentPeerId: rendererState?.currentPeerId,
        relay: safeRelay,
        exportedAt: new Date().toISOString(),
      };

      return diagnostics.exportBundle([
        { name: "settings-summary.json", content: JSON.stringify(settingsSummary, null, 2) },
        { name: "relay.json", content: JSON.stringify(safeRelay, null, 2) },
        { name: "summary.json", content: JSON.stringify(summary, null, 2) },
        {
          name: "renderer-session.json",
          content: JSON.stringify(safeRendererState, null, 2),
        },
        {
          name: "audio-timeline.json",
          content: JSON.stringify(rendererState?.audioTimeline ?? [], null, 2),
        },
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
  ipcMain.handle(IPC_CHANNELS.updates.check, async (): Promise<UpdateCheckResult> => {
    const result = await updates.check();
    diagnostics.setLastUpdateCheckMessage(result.message);
    return result;
  });
  ipcMain.handle(IPC_CHANNELS.updates.openReleases, async (): Promise<void> => {
    await updates.openReleases();
  });

  ipcMain.handle(IPC_CHANNELS.overlay.show, async (): Promise<boolean> => overlay.show());
  ipcMain.handle(IPC_CHANNELS.overlay.toggle, async (): Promise<boolean> => overlay.toggle());
  ipcMain.handle(IPC_CHANNELS.overlay.close, async (): Promise<void> => overlay.close());
  ipcMain.handle(
    IPC_CHANNELS.overlay.update,
    async (_event, state: OverlayState): Promise<void> => {
      if (!state || !Array.isArray(state.members) || state.members.length > 5)
        throw new Error("invalid_overlay_state");
      overlay.update(state);
    },
  );
  ipcMain.handle(IPC_CHANNELS.games.getSnapshot, async (): Promise<GameDetectionSnapshot> =>
    gameDetection.getSnapshot(),
  );
  ipcMain.handle(IPC_CHANNELS.updates.download, async (): Promise<void> => {
    await updates.download();
  });
  ipcMain.handle(IPC_CHANNELS.updates.install, async (): Promise<void> => {
    updates.install();
  });

  ipcMain.handle(IPC_CHANNELS.signaling.connect, async (_event, signalingUrl: string) => {
    const url = new URL(requireString(signalingUrl, 2_048, "signaling_url"));
    if (url.protocol !== "ws:" && url.protocol !== "wss:")
      throw new Error("invalid_signaling_protocol");
    await signalingClient.connect(url.toString());
  });
  ipcMain.handle(IPC_CHANNELS.signaling.send, async (_event, payload: string) => {
    const serialized = requireString(payload, 256 * 1024, "signaling_payload");
    const parsed = JSON.parse(serialized) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("invalid_signaling_payload");
    await signalingClient.send(serialized);
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
    IPC_CHANNELS.recording.saveMarkers,
    async (_event, filePath: string, markers: RecordingMarker[]): Promise<string> => {
      const parsedPath = path.parse(filePath);
      const markerPath = path.join(parsedPath.dir, `${parsedPath.name}-精彩时刻.txt`);
      const formatOffset = (offsetMs: number) => {
        const totalSeconds = Math.max(0, Math.round(offsetMs / 1_000));
        const hours = Math.floor(totalSeconds / 3_600);
        const minutes = Math.floor((totalSeconds % 3_600) / 60);
        const seconds = totalSeconds % 60;
        return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
      };
      const content = [
        "上号录音 · 精彩时刻",
        `录音文件：${path.basename(filePath)}`,
        "",
        ...markers.map((marker, index) => `${index + 1}. ${formatOffset(marker.offsetMs)}`),
        "",
        "打开录音并跳到对应时间即可回看。",
      ].join("\r\n");
      await writeFile(markerPath, content, "utf8");
      return markerPath;
    },
  );
};
