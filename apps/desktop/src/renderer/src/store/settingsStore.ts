import {
  APP_NAME,
  DEFAULT_ROOM_NAME,
  SETTINGS_SCHEMA_VERSION,
  TailscaleState,
  type AppSettings,
  type NetworkStatusSnapshot,
  type RuntimeInfo,
  type TailscaleStatus,
  type UpdateCheckResult,
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
  tailscaleStatus?: TailscaleStatus;
  networkSnapshot?: NetworkStatusSnapshot;
  updateInfo?: UpdateCheckResult;
  avatarDataUrl?: string;
  isHydrating: boolean;
  hydrate: () => Promise<StoreHydrationOutcome>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  pickAvatar: () => Promise<void>;
  clearAvatar: () => Promise<void>;
  refreshTailscale: () => Promise<void>;
  refreshNetworkSnapshot: () => Promise<void>;
  checkUpdates: () => Promise<UpdateCheckResult>;
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
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: false,
  reduceMotion: false,
  launchOnStartup: false,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  preferredSampleRate: "auto",
  inputLevelThreshold: 0.18,
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isAutoGainControlEnabled: true,
  isPushToTalkEnabled: false,
  micMonitorMode: "processed",
  connectionMode: "direct_host",
  relayServerUrl: "",
  relayAuthToken: "",
  manualDirectHost: "",
  shouldAutoCopyInviteLink: true,
  isMicOnSoundEnabled: true,
  isMicOffSoundEnabled: true,
  isMemberJoinSoundEnabled: true,
  isMemberLeaveSoundEnabled: true,
  isConnectionSoundEnabled: true,
  isBackgroundUpdateCheckEnabled: true,
  lastUpdateCheckAt: undefined,
  lastUpdateVersionSeen: undefined,
};

const fallbackTailscaleStatus: TailscaleStatus = {
  state: TailscaleState.Unknown,
  isInstalled: false,
  isConnected: false,
  message: "暂时无法读取 Tailscale 状态。",
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

const loadAvatarDataUrl = async (avatarPath?: string): Promise<string | undefined> => {
  if (!avatarPath) {
    return undefined;
  }

  return withTimeout(desktopApi.profile.readAvatar(avatarPath), "avatar_read_timeout", 3_000);
};

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: undefined,
  runtimeInfo: undefined,
  tailscaleStatus: fallbackTailscaleStatus,
  avatarDataUrl: undefined,
  networkSnapshot: undefined,
  updateInfo: undefined,
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

    let settings = await withTimeout(
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

    let avatarDataUrl: string | undefined;
    if (settings.avatarPath) {
      avatarDataUrl = await loadAvatarDataUrl(settings.avatarPath).catch(async (error) => {
        mode = "safe_mode";
        issue = issue ?? {
          title: "头像读取失败，已按安全模式启动",
          description: "本地头像文件不可用，已经临时忽略头像，不会影响继续使用。",
          details: [error instanceof Error ? error.message : String(error)],
        };
        await writeRendererLog("renderer-startup", "warn", "Failed to read local avatar", {
          avatarPath: settings.avatarPath,
          error: error instanceof Error ? error.message : String(error),
        });

        settings = {
          ...settings,
          avatarPath: undefined,
          hasCompletedProfileSetup: false,
        };

        void desktopApi.settings
          .save({
            avatarPath: undefined,
            hasCompletedProfileSetup: false,
          })
          .catch(() => undefined);

        return undefined;
      });
    }

    const [tailscaleStatus, networkSnapshot] = await Promise.all([
      withTimeout(desktopApi.tailscale.checkStatus(), "tailscale_timeout", 4_000).catch(
        async (error) => {
          await writeRendererLog("tailscale", "warn", "Failed to read Tailscale status", {
            error: error instanceof Error ? error.message : String(error),
          });
          return fallbackTailscaleStatus;
        },
      ),
      withTimeout(desktopApi.network.getSnapshot(), "network_snapshot_timeout", 4_000).catch(
        async (error) => {
          await writeRendererLog("proxy-diagnostics", "warn", "Failed to read network snapshot", {
            error: error instanceof Error ? error.message : String(error),
          });
          return undefined;
        },
      ),
    ]);

    set({
      runtimeInfo,
      settings,
      tailscaleStatus,
      networkSnapshot,
      avatarDataUrl,
      isHydrating: false,
    });

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
      tailscaleState: tailscaleStatus.state,
      hasAvatar: Boolean(settings.avatarPath),
      profileReady: settings.hasCompletedProfileSetup,
      connectionMode: settings.connectionMode,
      mode,
      settingsSchemaVersion: settings.settingsSchemaVersion,
    });

    return { mode, issue };
  },
  saveSettings: async (partial) => {
    const settings = await desktopApi.settings.save(partial);
    const avatarDataUrl = await loadAvatarDataUrl(settings.avatarPath).catch(async (error) => {
      await writeRendererLog("app", "warn", "Failed to refresh avatar preview", {
        avatarPath: settings.avatarPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
    set({ settings, avatarDataUrl });
    return settings;
  },
  pickAvatar: async () => {
    const selection = await desktopApi.profile.pickAvatar();
    if (!selection) {
      return;
    }

    const settings = await desktopApi.settings.save({ avatarPath: selection.avatarPath });
    set({ settings, avatarDataUrl: selection.avatarDataUrl });
  },
  clearAvatar: async () => {
    const avatarPath = get().settings?.avatarPath;
    await desktopApi.profile.clearAvatar(avatarPath);
    const settings = await desktopApi.settings.save({ avatarPath: undefined });
    set({ settings, avatarDataUrl: undefined });
  },
  refreshTailscale: async () => {
    const tailscaleStatus = await desktopApi.tailscale.checkStatus().catch(async (error) => {
      await writeRendererLog("tailscale", "warn", "Failed to refresh Tailscale status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackTailscaleStatus;
    });
    set({ tailscaleStatus });
  },
  refreshNetworkSnapshot: async () => {
    const networkSnapshot = await desktopApi.network.getSnapshot().catch(async (error) => {
      await writeRendererLog("proxy-diagnostics", "warn", "Failed to refresh network snapshot", {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    });
    set({ networkSnapshot });
  },
  checkUpdates: async () => {
    const updateInfo = await desktopApi.updates.check();
    set({ updateInfo });
    return updateInfo;
  },
  openReleases: async () => {
    await desktopApi.updates.openReleases();
  },
  resetSettings: async () => {
    const settings = await desktopApi.settings.reset();
    set({ settings, avatarDataUrl: undefined });
    await get().refreshTailscale();
    await get().refreshNetworkSnapshot();
  },
}));
