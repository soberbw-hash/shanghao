import {
  app,
  clipboard,
  dialog,
  ipcMain,
  net,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  session,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
} from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  APP_BUILD_NUMBER,
  APP_NAME,
  APP_PROTOCOL_VERSION,
  IPC_CHANNELS,
  type AppSettings,
  type AiModelAction,
  type AiModelId,
  type AiRuntimePressure,
  type AiRuntimeStatus,
  type AiVoiceMemorySnapshot,
  type ChatMessage,
  type DeepFilterAssets,
  type DeepLinkInvite,
  type DailyRoomReport,
  type DiagnosticsSnapshot,
  type GameDetectionSnapshot,
  type OverlayState,
  type RelayStatusSnapshot,
  type RealtimeFaultCommand,
  type RecordingExportPayload,
  type RecordingExportResponse,
  type RecordingCleanupScan,
  type RecordingBatchDeleteResult,
  type RecordingLibrarySnapshot,
  type RecordingLibraryItem,
  type RecordingMarker,
  type RendererLogPayload,
  type RendererRuntimeHealthInput,
  type RuntimeInfo,
  type RuntimeHealthSnapshot,
  type ScreenShareViewerOpenRequest,
  type ScreenShareViewerSignal,
  type SignalingEventPayload,
  type UpdateCheckResult,
  type UpdateStatus,
  type VoiceMemoryAnswer,
  type VoiceMemoryGlobalQuestionRequest,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryQuestionRequest,
  type VoiceMemoryRecord,
  type VoiceMemorySearchRequest,
  type VoiceMemorySearchResult,
  type LocalWeatherRequest,
  type LocalWeatherSnapshot,
  type WindowsIntegrationStatus,
} from "@private-voice/shared";

import { DiagnosticsService } from "./diagnostics";
import { captureRuntimeHealth } from "./runtime-health";
import { readDeepFilterAssets } from "./deepfilter-assets";
import { clearAvatarImage, pickAvatarImage, readAvatarImage } from "./profile-media";
import { exportRecordingFromMain } from "./recording-main";
import { resolveRecordingDirectory } from "./recording-path";
import {
  deleteRecording,
  enforceRecordingQuota,
  getUsableRecordingDirectory,
  readRecordingLibrary,
  renameRecording,
  scanWasteRecordings,
  setRecordingFavorite,
} from "./recording-library";
import { readRelayStatus } from "./relay-status";
import { sendToWindow } from "./safe-web-contents";
import { SettingsStore } from "./settings-store";
import { ShortcutController } from "./shortcuts";
import { SignalingClientBridge } from "./signaling-client";
import { UpdateService } from "./updates";
import { OverlayWindowController } from "./overlay-window";
import { GameDetectionController } from "./game-detection";
import { AiModelManager } from "./ai-model-manager";
import { AiVoiceMemoryService } from "./ai-voice-memory-service";
import { applyLaunchOnStartup } from "./launch-on-startup";
import { ChatHistoryStore } from "./chat-history-store";
import { DailyRoomReportCache } from "./daily-room-report-cache";
import { LocalWeatherService } from "./weather-service";
import { platformService } from "./platform/PlatformService";
import { readWindowsElevationStatus } from "./windows-elevation";
import {
  configureWindowsIconOverlays,
  readWindowsIntegrationStatus,
  removeWindowsIntegrationFirewall,
  repairWindowsIntegrationFirewall,
} from "./windows-integration";
import {
  closeScreenShareViewer,
  isScreenShareViewerSender,
  listScreenCaptureSources,
  openScreenShareViewer,
  setScreenCaptureContentProtection,
  sendScreenShareViewerSignal,
  selectScreenCaptureSource,
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
  aiModels: AiModelManager;
  voiceMemory: AiVoiceMemoryService;
  consumePendingDeepLink: () => DeepLinkInvite | undefined;
}

const requireString = (value: unknown, maximumLength: number, label: string): string => {
  if (typeof value !== "string" || value.length > maximumLength) {
    throw new Error(`invalid_${label}`);
  }
  return value;
};

let attentionResetTimer: NodeJS.Timeout | undefined;
let restoreAlwaysOnTop = false;
let windowShakeTimer: NodeJS.Timeout | undefined;
const linkPreviewIconCache = new Map<string, string | null>();

const readLinkPreviewIcon = async (rawUrl: string): Promise<string | undefined> => {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("link_preview_url_protocol_not_allowed");
  }
  if (url.username || url.password) throw new Error("link_preview_url_credentials_not_allowed");

  const cacheKey = url.origin;
  if (linkPreviewIconCache.has(cacheKey)) {
    return linkPreviewIconCache.get(cacheKey) ?? undefined;
  }

  try {
    const faviconUrl = `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(
      url.origin,
    )}&sz=128`;
    const response = await net.fetch(faviconUrl, {
      headers: { Accept: "image/avif,image/webp,image/png,image/*" },
      signal: AbortSignal.timeout(5_000),
    });
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (
      !response.ok ||
      !contentType?.startsWith("image/") ||
      (contentLength > 0 && contentLength > 256 * 1024)
    ) {
      linkPreviewIconCache.set(cacheKey, null);
      return undefined;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 256 * 1024) {
      linkPreviewIconCache.set(cacheKey, null);
      return undefined;
    }
    const dataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
    if (linkPreviewIconCache.size >= 128) {
      const oldestKey = linkPreviewIconCache.keys().next().value;
      if (oldestKey) linkPreviewIconCache.delete(oldestKey);
    }
    linkPreviewIconCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    linkPreviewIconCache.set(cacheKey, null);
    return undefined;
  }
};

const bringWindowToFront = (mainWindow: BrowserWindow | null, attention = false): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.moveTop();
  mainWindow.focus();
  if (!attention) return;

  if (!attentionResetTimer) restoreAlwaysOnTop = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.flashFrame(true);
  if (attentionResetTimer) clearTimeout(attentionResetTimer);
  attentionResetTimer = setTimeout(() => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
      if (!restoreAlwaysOnTop) mainWindow.setAlwaysOnTop(false);
    }
    attentionResetTimer = undefined;
    restoreAlwaysOnTop = false;
  }, 1_800);
  attentionResetTimer.unref?.();
};

const shakeMainWindow = (mainWindow: BrowserWindow | null): void => {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.isMaximized() ||
    mainWindow.isFullScreen()
  )
    return;
  if (windowShakeTimer) clearInterval(windowShakeTimer);
  const original = mainWindow.getBounds();
  const display = screen.getDisplayMatching(original).workArea;
  const offsets = [-14, 14, -12, 12, -9, 9, -5, 5, 0];
  let index = 0;
  windowShakeTimer = setInterval(() => {
    if (mainWindow.isDestroyed()) {
      if (windowShakeTimer) clearInterval(windowShakeTimer);
      windowShakeTimer = undefined;
      return;
    }
    const offset = offsets[index] ?? 0;
    const x = Math.max(
      display.x,
      Math.min(original.x + offset, display.x + display.width - original.width),
    );
    mainWindow.setPosition(x, original.y, false);
    index += 1;
    if (index >= offsets.length) {
      if (windowShakeTimer) clearInterval(windowShakeTimer);
      windowShakeTimer = undefined;
      mainWindow.setPosition(original.x, original.y, false);
    }
  }, 42);
  windowShakeTimer.unref?.();
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

const createChatHistoryRoomKey = (serverUrl: unknown, channelId: unknown): string => {
  const rawServerUrl = requireString(serverUrl, 2_048, "chat_history_server_url");
  const safeChannelId = requireString(channelId, 64, "chat_history_channel_id");
  const url = new URL(rawServerUrl);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("invalid_chat_history_server_protocol");
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return `${url.toString()}|${safeChannelId}`;
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
  aiModels,
  voiceMemory,
  consumePendingDeepLink,
}: MainProcessServices): void => {
  const chatHistoryStore = new ChatHistoryStore(app.getPath("userData"));
  const dailyRoomReportCache = new DailyRoomReportCache(app.getPath("userData"));
  const weatherSession = session.fromPartition("shanghao-weather-direct", { cache: false });
  const weatherNetworkReady = weatherSession.setProxy({ mode: "direct" });
  const localWeather = new LocalWeatherService(app.getPath("userData"), {
    fetcher: async (input, init) => {
      await weatherNetworkReady;
      return weatherSession.fetch(input instanceof URL ? input.toString() : input, init);
    },
  });
  signalingClient.on("event", (payload: SignalingEventPayload) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.signaling.event, payload);
  });
  updates.onStatus((status: UpdateStatus) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.updates.status, status);
  });
  gameDetection.onDetected((snapshot) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.games.detected, snapshot);
  });
  aiModels.onStatus((snapshot) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.ai.status, snapshot);
  });
  voiceMemory.onStatus((record) => {
    sendToWindow(getMainWindow(), IPC_CHANNELS.ai.voiceMemoryStatus, record);
  });

  ipcMain.handle(IPC_CHANNELS.app.getRuntimeInfo, async (): Promise<RuntimeInfo> => {
    const elevation = await readWindowsElevationStatus();
    return {
      appName: APP_NAME,
      version: app.getVersion(),
      platform: platformService.capabilities.nodePlatform,
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      isStartupLaunch: process.argv.includes("--shanghao-startup"),
      isElevated: elevation.isElevated,
      requestedExecutionLevel: app.isPackaged ? "requireAdministrator" : "asInvoker",
    };
  });

  ipcMain.handle(IPC_CHANNELS.app.getSystemIdleSeconds, async (): Promise<number> => {
    // Deterministic visual captures should exercise the seated room state even
    // when the development machine itself has been idle for over 30 minutes.
    if (process.env.SHANGHAO_CAPTURE_PATH) return 0;
    return Math.max(0, powerMonitor.getSystemIdleTime());
  });
  ipcMain.handle(IPC_CHANNELS.app.consumeDeepLink, async (): Promise<DeepLinkInvite | undefined> =>
    consumePendingDeepLink(),
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
    async (
      _event,
      payload: {
        title: string;
        body: string;
        attention?: boolean;
        shakeWindow?: boolean;
        showNotification?: boolean;
      },
    ): Promise<void> => {
      requireString(payload?.title, 80, "notification_title");
      requireString(payload?.body, 180, "notification_body");
      const mainWindow = getMainWindow();
      if (payload.attention === true) bringWindowToFront(mainWindow, true);
      if (payload.shakeWindow === true) shakeMainWindow(mainWindow);
      if (payload.showNotification === false) return;
      if (!Notification.isSupported()) {
        return;
      }
      const notification = new Notification({
        title: payload.title.slice(0, 80),
        body: payload.body.slice(0, 180),
        silent: false,
      });
      notification.on("click", () => {
        bringWindowToFront(getMainWindow());
      });
      notification.show();
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.app.readChatHistory,
    async (_event, payload: { serverUrl?: unknown; channelId?: unknown }): Promise<ChatMessage[]> =>
      chatHistoryStore.read(createChatHistoryRoomKey(payload?.serverUrl, payload?.channelId)),
  );
  ipcMain.handle(
    IPC_CHANNELS.app.saveChatHistory,
    async (
      _event,
      payload: { serverUrl?: unknown; channelId?: unknown; messages?: unknown },
    ): Promise<void> => {
      if (!Array.isArray(payload?.messages)) throw new Error("invalid_chat_history_messages");
      if (JSON.stringify(payload.messages).length > 28 * 1024 * 1024) {
        throw new Error("chat_history_payload_too_large");
      }
      await chatHistoryStore.save(
        createChatHistoryRoomKey(payload.serverUrl, payload.channelId),
        payload.messages as ChatMessage[],
      );
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.app.readDailyRoomReports,
    async (): Promise<Record<"main" | "side", DailyRoomReport[]>> => dailyRoomReportCache.read(),
  );
  ipcMain.handle(
    IPC_CHANNELS.app.saveDailyRoomReports,
    async (_event, reports: Record<"main" | "side", DailyRoomReport[]>): Promise<void> => {
      if (!reports || typeof reports !== "object") {
        throw new Error("invalid_daily_room_reports");
      }
      if (JSON.stringify(reports).length > 2 * 1024 * 1024) {
        throw new Error("daily_room_reports_payload_too_large");
      }
      await dailyRoomReportCache.save(reports);
    },
  );
  ipcMain.handle(IPC_CHANNELS.app.openExternal, async (_event, rawUrl: string): Promise<void> => {
    requireString(rawUrl, 2_048, "external_url");
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("external_url_protocol_not_allowed");
    }
    if (url.username || url.password) throw new Error("external_url_credentials_not_allowed");
    await shell.openExternal(url.toString());
  });
  ipcMain.handle(
    IPC_CHANNELS.app.getLinkPreviewIcon,
    async (_event, rawUrl: string): Promise<string | undefined> => {
      requireString(rawUrl, 2_048, "link_preview_url");
      return readLinkPreviewIcon(rawUrl);
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
  ipcMain.handle(
    IPC_CHANNELS.clipboard.writeImage,
    async (_event, dataUrl: string): Promise<void> => {
      requireString(dataUrl, 12 * 1024 * 1024, "clipboard_image");
      if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(dataUrl)) {
        throw new Error("invalid_clipboard_image");
      }
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) throw new Error("invalid_clipboard_image");
      clipboard.writeImage(image);
    },
  );

  ipcMain.handle(IPC_CHANNELS.audio.getDeepFilterAssets, async (): Promise<DeepFilterAssets> => {
    try {
      const assets = await readDeepFilterAssets();
      await diagnostics.writeLog({
        category: "audio",
        level: "info",
        message: "Loaded local DeepFilterNet assets",
        context: {
          wasmBytes: assets.wasm.byteLength,
          modelBytes: assets.model.byteLength,
        },
      });
      return assets;
    } catch (error) {
      await diagnostics.writeLog({
        category: "audio",
        level: "error",
        message: "Failed to load local DeepFilterNet assets",
        context: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  });

  ipcMain.handle(IPC_CHANNELS.screenCapture.listSources, async () => listScreenCaptureSources());
  ipcMain.handle(
    IPC_CHANNELS.screenCapture.selectSource,
    async (_event, sourceId: unknown): Promise<void> => {
      selectScreenCaptureSource(requireString(sourceId, 256, "screen_source_id"));
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.screenCapture.setContentProtection,
    async (_event, enabled: unknown): Promise<void> => {
      if (typeof enabled !== "boolean") throw new Error("invalid_content_protection_state");
      setScreenCaptureContentProtection(enabled);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.screenShareViewer.open,
    async (_event, request: ScreenShareViewerOpenRequest): Promise<void> => {
      if (!request || typeof request !== "object") throw new Error("invalid_screen_viewer_open");
      await openScreenShareViewer({
        title: requireString(request.title, 160, "screen_viewer_title"),
        sessionId: requireString(request.sessionId, 128, "screen_viewer_session"),
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.screenShareViewer.sendSignal,
    async (event, signal: ScreenShareViewerSignal): Promise<boolean> => {
      if (!signal || typeof signal !== "object") throw new Error("invalid_screen_viewer_signal");
      const sessionId = requireString(signal.sessionId, 128, "screen_viewer_session");
      const sender = signal.sender;
      const type = signal.type;
      if (!(["host", "viewer"] as const).includes(sender)) {
        throw new Error("invalid_screen_viewer_sender");
      }
      if (
        !(["ready", "offer", "answer", "ice", "fallback-frame", "closed"] as const).includes(type)
      ) {
        throw new Error("invalid_screen_viewer_signal_type");
      }
      const mainWindow = getMainWindow();
      if (sender === "host") {
        if (!mainWindow || event.sender.id !== mainWindow.webContents.id) {
          throw new Error("invalid_screen_viewer_host");
        }
      } else if (!isScreenShareViewerSender(event.sender.id, sessionId)) {
        throw new Error("invalid_screen_viewer_client");
      }

      const safeSignal: ScreenShareViewerSignal = {
        sessionId,
        sender,
        type,
        title: signal.title ? requireString(signal.title, 160, "screen_viewer_title") : undefined,
        sdp: signal.sdp ? requireString(signal.sdp, 128_000, "screen_viewer_sdp") : undefined,
        candidate: signal.candidate
          ? requireString(signal.candidate, 8_192, "screen_viewer_candidate")
          : undefined,
        sdpMid: typeof signal.sdpMid === "string" ? signal.sdpMid.slice(0, 128) : signal.sdpMid,
        sdpMLineIndex:
          typeof signal.sdpMLineIndex === "number" ? signal.sdpMLineIndex : signal.sdpMLineIndex,
        frameDataUrl: signal.frameDataUrl
          ? requireString(signal.frameDataUrl, 8 * 1024 * 1024, "screen_viewer_frame")
          : undefined,
      };

      if (sender === "host") return sendScreenShareViewerSignal(safeSignal);
      sendToWindow(mainWindow, IPC_CHANNELS.screenShareViewer.signal, safeSignal);
      return Boolean(mainWindow && !mainWindow.isDestroyed());
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
          await applyLaunchOnStartup(partial.launchOnStartup);
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
      if (partial.aiProcessingMode) aiModels.setProcessingMode(settings.aiProcessingMode);
      if (partial.isAiAutoTranscribeEnabled === true) {
        const library = await readRecordingLibrary(
          settings.recordingSaveDirectory,
          settings.recordingLibraryQuotaGb,
        );
        void voiceMemory
          .queueRecordings(
            library.items.map((item) => ({
              filePath: item.filePath,
              roomId: item.roomId,
              markers: item.markers.map((marker) => ({ id: marker.id, offsetMs: marker.offsetMs })),
            })),
            settings.isAiAutoOrganizeEnabled,
          )
          .catch((error) =>
            diagnostics.writeLog({
              category: "app",
              level: "warn",
              message: "voice_memory_library_queue_failed",
              context: { error: error instanceof Error ? error.message : String(error) },
            }),
          );
      }
      if (typeof partial.isGameDetectionEnabled === "boolean") {
        await gameDetection.setEnabled(settings.isGameDetectionEnabled);
      }
      if (typeof partial.isWorkActivityVisible === "boolean") {
        await gameDetection.setWorkActivityEnabled(settings.isWorkActivityVisible);
      }
      const registered = await shortcuts.configureGlobalMute(settings.globalMuteShortcut);
      if (!registered && settings.globalMuteShortcut) {
        return settingsStore.save({ globalMuteShortcut: "" });
      }
      return settings;
    },
  );

  ipcMain.handle(IPC_CHANNELS.settings.reset, async (): Promise<AppSettings> => {
    const settings = await settingsStore.reset();
    aiModels.setProcessingMode(settings.aiProcessingMode);
    await gameDetection.setWorkActivityEnabled(settings.isWorkActivityVisible);
    await gameDetection.setEnabled(settings.isGameDetectionEnabled);
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
    IPC_CHANNELS.diagnostics.runtimeHealth,
    async (_event, renderer?: RendererRuntimeHealthInput): Promise<RuntimeHealthSnapshot> => {
      const snapshot = await captureRuntimeHealth({
        getMainWindow,
        renderer,
        flightRecorder: diagnostics.flightRecorder,
      });
      diagnostics.setRuntimeHealthSnapshot(snapshot);
      return snapshot;
    },
  );
  ipcMain.handle(IPC_CHANNELS.windows.getStatus, async (): Promise<WindowsIntegrationStatus> =>
    readWindowsIntegrationStatus(),
  );
  ipcMain.handle(IPC_CHANNELS.windows.repairFirewall, async () => {
    const status = await repairWindowsIntegrationFirewall();
    await diagnostics.writeLog({
      category: "app",
      level: status.healthy ? "info" : "warn",
      message: "Windows firewall rules repaired",
      context: { ...status },
    });
    return status;
  });
  ipcMain.handle(IPC_CHANNELS.windows.removeFirewall, async () => {
    const status = await removeWindowsIntegrationFirewall();
    await diagnostics.writeLog({
      category: "app",
      level: "info",
      message: "Windows firewall rules removed",
      context: { ...status },
    });
    return status;
  });
  ipcMain.handle(
    IPC_CHANNELS.windows.setIconOverlaysHidden,
    async (_event, hidden: unknown): Promise<WindowsIntegrationStatus["iconOverlays"]> => {
      if (typeof hidden !== "boolean") throw new Error("invalid_icon_overlay_state");
      const status = await configureWindowsIconOverlays(hidden);
      await diagnostics.writeLog({
        category: "app",
        level: "info",
        message: hidden ? "Windows icon overlays hidden" : "Windows icon overlays restored",
        context: { ...status },
      });
      return status;
    },
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
        microphoneProcessingSampleRate: 48_000,
        lowCutFrequency: settings.lowCutFrequency,
        micEqualizerGains: settings.micEqualizerGains,
        isVoiceEnhancementEnabled: settings.isVoiceEnhancementEnabled,
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
      const windowsIntegration = await readWindowsIntegrationStatus();
      const runtimeHealth =
        diagnostics.getRuntimeHealthSnapshot() ??
        (await captureRuntimeHealth({
          getMainWindow,
          flightRecorder: diagnostics.flightRecorder,
        }));

      return diagnostics.exportBundle([
        { name: "settings-summary.json", content: JSON.stringify(settingsSummary, null, 2) },
        { name: "relay.json", content: JSON.stringify(safeRelay, null, 2) },
        { name: "summary.json", content: JSON.stringify(summary, null, 2) },
        {
          name: "windows-integration.json",
          content: JSON.stringify(windowsIntegration, null, 2),
        },
        {
          name: "renderer-session.json",
          content: JSON.stringify(safeRendererState, null, 2),
        },
        {
          name: "audio-timeline.json",
          content: JSON.stringify(rendererState?.audioTimeline ?? [], null, 2),
        },
        {
          name: "runtime-health.json",
          content: JSON.stringify(runtimeHealth, null, 2),
        },
        {
          name: "flight-recorder.json",
          content: JSON.stringify(diagnostics.flightRecorder.snapshot(), null, 2),
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
    IPC_CHANNELS.overlay.setInteractive,
    async (_event, interactive: boolean): Promise<void> => overlay.setInteractive(interactive),
  );
  ipcMain.handle(IPC_CHANNELS.overlay.moveTo, async (_event, screenY: number): Promise<void> =>
    overlay.moveTo(screenY),
  );
  ipcMain.handle(IPC_CHANNELS.overlay.resetPosition, async (): Promise<void> =>
    overlay.resetPosition(),
  );
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
  ipcMain.handle(
    IPC_CHANNELS.weather.getSnapshot,
    async (_event, request: LocalWeatherRequest): Promise<LocalWeatherSnapshot> =>
      localWeather.getSnapshot(request),
  );
  ipcMain.handle(IPC_CHANNELS.ai.getSnapshot, async (): Promise<AiVoiceMemorySnapshot> =>
    aiModels.getSnapshot(),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.controlModel,
    async (_event, modelId: AiModelId, action: AiModelAction): Promise<AiVoiceMemorySnapshot> => {
      if (modelId !== "vibevoice" && modelId !== "qwen35-4b") throw new Error("invalid_ai_model");
      if (!["download", "pause", "resume", "delete"].includes(action)) {
        throw new Error("invalid_ai_model_action");
      }
      return aiModels.controlModel(modelId, action);
    },
  );
  ipcMain.handle(IPC_CHANNELS.ai.runtimeStatus, async (): Promise<AiRuntimeStatus> =>
    voiceMemory.getRuntimeStatus(),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.getVoiceMemory,
    async (_event, recordingId: string): Promise<VoiceMemoryRecord | undefined> =>
      voiceMemory.get(requireString(recordingId, 2_048, "recording_id")),
  );
  ipcMain.handle(IPC_CHANNELS.ai.listVoiceMemories, async (): Promise<VoiceMemoryRecord[]> =>
    voiceMemory.list(),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.processRecording,
    async (_event, request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> =>
      voiceMemory.start({
        ...request,
        recordingId: requireString(request.recordingId, 2_048, "recording_id"),
        filePath: requireString(request.filePath, 2_048, "recording_file_path"),
      }),
  );
  ipcMain.handle(IPC_CHANNELS.ai.pauseTask, async (_event, recordingId: string): Promise<void> => {
    voiceMemory.pause(requireString(recordingId, 2_048, "recording_id"));
  });
  ipcMain.handle(
    IPC_CHANNELS.ai.resumeTask,
    async (_event, recordingId: string): Promise<VoiceMemoryRecord> =>
      voiceMemory.resume(requireString(recordingId, 2_048, "recording_id")),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.assignSpeaker,
    async (
      _event,
      recordingId: string,
      speakerId: string,
      memberId: string,
      nickname: string,
    ): Promise<VoiceMemoryRecord> =>
      voiceMemory.assignSpeaker(
        requireString(recordingId, 2_048, "recording_id"),
        requireString(speakerId, 100, "speaker_id"),
        requireString(memberId, 180, "member_id"),
        requireString(nickname, 80, "nickname"),
      ),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.updateMarkerTitle,
    async (
      _event,
      recordingId: string,
      markerId: string,
      title: string,
    ): Promise<VoiceMemoryRecord> =>
      voiceMemory.updateMarkerTitle(
        requireString(recordingId, 2_048, "recording_id"),
        requireString(markerId, 180, "marker_id"),
        requireString(title, 120, "marker_title"),
      ),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.askRecording,
    async (_event, request: VoiceMemoryQuestionRequest): Promise<VoiceMemoryAnswer> =>
      voiceMemory.ask({
        recordingId: requireString(request.recordingId, 2_048, "recording_id"),
        question: requireString(request.question, 500, "recording_question"),
      }),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.askMemory,
    async (_event, request: VoiceMemoryGlobalQuestionRequest): Promise<VoiceMemoryAnswer> =>
      voiceMemory.askMemory({
        question: requireString(request.question, 500, "memory_question"),
      }),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.searchMemory,
    async (_event, request: VoiceMemorySearchRequest): Promise<VoiceMemorySearchResult[]> =>
      voiceMemory.search({
        ...request,
        query: requireString(request.query, 500, "voice_memory_search"),
      }),
  );
  ipcMain.handle(
    IPC_CHANNELS.ai.updateRuntimePressure,
    async (_event, pressure: AiRuntimePressure): Promise<void> => {
      if (!pressure || typeof pressure !== "object") throw new Error("invalid_ai_runtime_pressure");
      aiModels.updateRuntimePressure({
        inVoiceRoom: Boolean(pressure.inVoiceRoom),
        screenSharing: Boolean(pressure.screenSharing),
        peerRecovering: Boolean(pressure.peerRecovering),
        latencyMs: Math.max(0, Math.min(60_000, Number(pressure.latencyMs) || 0)),
        packetLossPercent: Math.max(0, Math.min(100, Number(pressure.packetLossPercent) || 0)),
        rendererMemoryPressure: Boolean(pressure.rendererMemoryPressure),
        updatedAt: Math.max(0, Number(pressure.updatedAt) || Date.now()),
      });
    },
  );
  ipcMain.handle(IPC_CHANNELS.updates.download, async (): Promise<void> => {
    await updates.download();
  });
  ipcMain.handle(IPC_CHANNELS.updates.install, async (): Promise<void> => {
    updates.install();
  });

  ipcMain.handle(
    IPC_CHANNELS.signaling.connect,
    async (_event, signalingUrl: string, sessionId: string) => {
      const url = new URL(requireString(signalingUrl, 2_048, "signaling_url"));
      if (url.protocol !== "ws:" && url.protocol !== "wss:")
        throw new Error("invalid_signaling_protocol");
      await signalingClient.connect(
        url.toString(),
        requireString(sessionId, 128, "signaling_session_id"),
      );
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.signaling.send,
    async (_event, payload: string, sessionId: string) => {
      const serialized = requireString(payload, 256 * 1024, "signaling_payload");
      const parsed = JSON.parse(serialized) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("invalid_signaling_payload");
      await signalingClient.send(serialized, requireString(sessionId, 128, "signaling_session_id"));
    },
  );
  ipcMain.handle(IPC_CHANNELS.signaling.close, async (_event, sessionId: string) => {
    await signalingClient.close(requireString(sessionId, 128, "signaling_session_id"));
  });
  ipcMain.handle(
    IPC_CHANNELS.signaling.injectFault,
    async (_event, sessionId: string, command: RealtimeFaultCommand): Promise<void> => {
      if (app.isPackaged) throw new Error("fault_lab_unavailable_in_packaged_app");
      if (!command || typeof command.kind !== "string") throw new Error("invalid_fault_command");
      signalingClient.injectFault(requireString(sessionId, 128, "signaling_session_id"), command);
      diagnostics.flightRecorder.record({
        source: "realtime",
        level: "warn",
        event: `fault_lab:${command.kind}`,
      });
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.recording.export,
    async (_event, payload: RecordingExportPayload): Promise<RecordingExportResponse> => {
      const settings = settingsStore.getSnapshot();
      const result = await exportRecordingFromMain(
        payload,
        settings.recordingSaveDirectory,
        (logPayload) => diagnostics.writeLog(logPayload),
      );
      if (result.ok) {
        await enforceRecordingQuota(
          settings.recordingSaveDirectory,
          settings.recordingLibraryQuotaGb,
        );
      }
      return result;
    },
  );
  ipcMain.handle(IPC_CHANNELS.recording.chooseDirectory, async (): Promise<string | undefined> => {
    const currentDirectory = resolveRecordingDirectory(
      settingsStore.getSnapshot().recordingSaveDirectory,
      app.getPath("documents"),
    );
    const options: OpenDialogOptions = {
      title: "选择录音保存位置",
      buttonLabel: "使用这个文件夹",
      defaultPath: currentDirectory,
      properties: ["openDirectory", "createDirectory"],
    };
    const mainWindow = getMainWindow();
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
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
  ipcMain.handle(IPC_CHANNELS.recording.list, async (): Promise<RecordingLibrarySnapshot> => {
    const settings = settingsStore.getSnapshot();
    return readRecordingLibrary(settings.recordingSaveDirectory, settings.recordingLibraryQuotaGb);
  });
  ipcMain.handle(IPC_CHANNELS.recording.scanWaste, async (): Promise<RecordingCleanupScan> => {
    const settings = settingsStore.getSnapshot();
    return scanWasteRecordings(
      settings.recordingSaveDirectory,
      settings.recordingLibraryQuotaGb,
      (processed, total) =>
        sendToWindow(getMainWindow(), IPC_CHANNELS.recording.scanWasteProgress, {
          processed,
          total,
        }),
    );
  });
  ipcMain.handle(
    IPC_CHANNELS.recording.setFavorite,
    async (_event, filePath: string, isFavorite: boolean): Promise<void> => {
      if (typeof isFavorite !== "boolean") throw new Error("invalid_recording_favorite");
      await setRecordingFavorite(
        settingsStore.getSnapshot().recordingSaveDirectory,
        requireString(filePath, 2_048, "recording_file_path"),
        isFavorite,
      );
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.rename,
    async (_event, recordingId: string, title: string): Promise<RecordingLibraryItem> => {
      const settings = settingsStore.getSnapshot();
      const stableId = requireString(recordingId, 180, "recording_id");
      const nextTitle = requireString(title, 124, "recording_title");
      const before = await readRecordingLibrary(
        settings.recordingSaveDirectory,
        settings.recordingLibraryQuotaGb,
      );
      const previous = before.items.find((item) => item.recordingId === stableId);
      if (!previous) throw new Error("recording_not_found");
      const renamed = await renameRecording(settings.recordingSaveDirectory, stableId, nextTitle);
      try {
        await voiceMemory.reconcileRecordingIdentity(
          previous.filePath,
          renamed.recordingId,
          renamed.filePath,
          renamed.markers,
        );
        await voiceMemory.reconcileRecordingIdentity(
          renamed.recordingId,
          renamed.recordingId,
          renamed.filePath,
          renamed.markers,
        );
        return renamed;
      } catch (error) {
        await renameRecording(
          settings.recordingSaveDirectory,
          stableId,
          path.parse(previous.fileName).name,
        ).catch(() => undefined);
        throw error;
      }
    },
  );
  ipcMain.handle(IPC_CHANNELS.recording.openDirectory, async (): Promise<void> => {
    const directory = await getUsableRecordingDirectory(
      settingsStore.getSnapshot().recordingSaveDirectory,
    );
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC_CHANNELS.recording.delete, async (_event, filePath: string): Promise<void> => {
    const recordingPath = requireString(filePath, 2_048, "recording_file_path");
    const settings = settingsStore.getSnapshot();
    const library = await readRecordingLibrary(
      settings.recordingSaveDirectory,
      settings.recordingLibraryQuotaGb,
    );
    const item = library.items.find((candidate) => candidate.filePath === recordingPath);
    await deleteRecording(settings.recordingSaveDirectory, recordingPath);
    try {
      if (item) await voiceMemory.delete(item.recordingId);
      await voiceMemory.delete(recordingPath);
    } catch (error) {
      await diagnostics.writeLog({
        category: "recording",
        level: "warn",
        message: "Recording deleted but voice-memory cleanup failed",
        context: {
          recordingId: item?.recordingId ?? recordingPath,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
  ipcMain.handle(
    IPC_CHANNELS.recording.deleteMany,
    async (_event, filePaths: unknown): Promise<RecordingBatchDeleteResult> => {
      if (!Array.isArray(filePaths) || filePaths.length > 500) {
        throw new Error("invalid_recording_delete_batch");
      }
      const requested = [
        ...new Set(
          filePaths.map((filePath) => requireString(filePath, 2_048, "recording_file_path")),
        ),
      ];
      const deleteSettings = settingsStore.getSnapshot();
      const deleteLibrary = await readRecordingLibrary(
        deleteSettings.recordingSaveDirectory,
        deleteSettings.recordingLibraryQuotaGb,
      );
      const itemsByPath = new Map(deleteLibrary.items.map((item) => [item.filePath, item]));
      const result: RecordingBatchDeleteResult = { deletedFilePaths: [], failed: [] };
      for (let index = 0; index < requested.length; index += 4) {
        const batch = requested.slice(index, index + 4);
        const settled = await Promise.allSettled(
          batch.map(async (recordingPath) => {
            const item = itemsByPath.get(recordingPath);
            await deleteRecording(deleteSettings.recordingSaveDirectory, recordingPath);
            try {
              if (item) await voiceMemory.delete(item.recordingId);
              await voiceMemory.delete(recordingPath);
            } catch (error) {
              await diagnostics.writeLog({
                category: "recording",
                level: "warn",
                message: "Recording deleted but voice-memory cleanup failed",
                context: {
                  recordingId: item?.recordingId ?? recordingPath,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            }
            return recordingPath;
          }),
        );
        settled.forEach((entry, entryIndex) => {
          const filePath = batch[entryIndex];
          if (!filePath) return;
          if (entry.status === "fulfilled") {
            result.deletedFilePaths.push(filePath);
          } else {
            result.failed.push({
              filePath,
              message: entry.reason instanceof Error ? entry.reason.message : String(entry.reason),
            });
          }
        });
      }
      return result;
    },
  );
};
