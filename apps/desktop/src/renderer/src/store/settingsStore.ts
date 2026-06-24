import {
  APP_NAME,
  DEFAULT_ROOM_NAME,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  type AppSettings,
  type RuntimeInfo,
  type UpdateCheckResult,
  type UpdateStatus,
} from "@private-voice/shared";
import { create } from "zustand";

import { desktopApi } from "../utils/desktopApi";
import { writeRendererLog } from "../utils/logger";

interface StoreHydrationOutcome {
  mode: "ready" | "safe_mode";
  issue?: {
    title: string;
    description: string;
    details?: string[];
  };
}

interface SettingsStoreState {
  runtimeInfo?: RuntimeInfo;
  settings?: AppSettings;
  updateInfo?: UpdateCheckResult;
  updateStatus: UpdateStatus;
  avatarDataUrl?: string;
  isHydrating: boolean;
  hydrate: () => Promise<StoreHydrationOutcome>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  checkUpdates: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  openReleases: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const HYDRATE_TIMEOUT_MS = 5_000;

const fallbackRuntimeInfo: RuntimeInfo = {
  appName: APP_NAME,
  version: "0.0.0",
  platform: typeof navigator === "undefined" ? "unknown" : navigator.platform,
  protocolVersion: "1",
  buildNumber: "unknown",
};

const fallbackSettings: AppSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  profileSchemaVersion: PROFILE_SCHEMA_VERSION,
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarId: "fox",
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: false,
  reduceMotion: false,
  launchOnStartup: false,
  isHardwareAccelerationEnabled: true,
  isOverlayEnabled: true,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  preferredSampleRate: "auto",
  inputLevelThreshold: 0.4,
  micEqualizerGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isAutoGainControlEnabled: true,
  isPushToTalkEnabled: false,
  micMonitorMode: "processed",
  relayServerUrl: "",
  isMicOnSoundEnabled: true,
  isMicOffSoundEnabled: true,
  isMemberJoinSoundEnabled: true,
  isMemberLeaveSoundEnabled: true,
  isConnectionSoundEnabled: true,
  isUiSoundEnabled: true,
  isBackgroundUpdateCheckEnabled: true,
  lastUpdateCheckAt: undefined,
  lastUpdateVersionSeen: undefined,
};

const withTimeout = async <T>(
  task: Promise<T>,
  timeoutMessage: string,
  timeoutMs = HYDRATE_TIMEOUT_MS,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    task
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: undefined,
  runtimeInfo: undefined,
  avatarDataUrl: undefined,
  updateInfo: undefined,
  updateStatus: { phase: "idle", message: "暂未检查更新" },
  isHydrating: true,
  hydrate: async () => {
    set({ isHydrating: true });

    let mode: StoreHydrationOutcome["mode"] = "ready";
    let issue: StoreHydrationOutcome["issue"];

    const runtimeInfo = await withTimeout(
      desktopApi.app.getRuntimeInfo(),
      "runtime_info_timeout",
      3_000,
    ).catch(async (error) => {
      await writeRendererLog("renderer-startup", "warn", "Falling back to runtime info", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackRuntimeInfo;
    });

    const settings = await withTimeout(
      desktopApi.settings.get(),
      "settings_read_timeout",
      HYDRATE_TIMEOUT_MS,
    ).catch(async (error) => {
      mode = "safe_mode";
      issue = {
        title: "设置读取失败，已进入安全模式",
        description: "上号已用默认设置启动。你可以先进入首页，再去设置里继续检查。",
        details: [error instanceof Error ? error.message : String(error)],
      };
      await writeRendererLog("renderer-startup", "error", "Failed to hydrate settings", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackSettings;
    });

    set({
      runtimeInfo,
      settings,
      avatarDataUrl: undefined,
      isHydrating: false,
    });

    desktopApi.updates.onStatus((updateStatus) => set({ updateStatus }));

    await desktopApi.shortcuts.configureMute(settings.globalMuteShortcut).catch(async (error) => {
      await writeRendererLog("renderer-startup", "warn", "Failed to configure mute shortcut", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    if (settings.isBackgroundUpdateCheckEnabled) {
      void get().checkUpdates().catch(() => undefined);
    }

    await writeRendererLog("renderer-startup", "info", "Renderer hydrated settings", {
      platform: runtimeInfo.platform,
      avatarId: settings.avatarId,
      profileSchemaVersion: settings.profileSchemaVersion,
      profileReady: settings.hasCompletedProfileSetup,
      serverConfigured: Boolean(settings.relayServerUrl?.trim()),
      mode,
      settingsSchemaVersion: settings.settingsSchemaVersion,
    });

    return { mode, issue };
  },
  saveSettings: async (partial) => {
    const settings = await desktopApi.settings.save(partial);
    set({ settings, avatarDataUrl: undefined });
    return settings;
  },
  checkUpdates: async () => {
    const updateInfo = await desktopApi.updates.check();
    set({ updateInfo });
    return updateInfo;
  },
  downloadUpdate: async () => {
    await desktopApi.updates.download();
  },
  installUpdate: async () => {
    await desktopApi.updates.install();
  },
  openReleases: async () => {
    await desktopApi.updates.openReleases();
  },
  resetSettings: async () => {
    const settings = await desktopApi.settings.reset();
    set({ settings, avatarDataUrl: undefined });
  },
}));
