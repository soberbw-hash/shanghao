import {
  APP_NAME,
  DEFAULT_ROOM_NAME,
  TailscaleState,
  type AppSettings,
  type RuntimeInfo,
  type TailscaleStatus,
} from "@private-voice/shared";
import { create } from "zustand";

import { desktopApi } from "../utils/desktopApi";
import { writeRendererLog } from "../utils/logger";

export interface HydrationOutcome {
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
  avatarDataUrl?: string;
  isHydrating: boolean;
  hydrate: () => Promise<HydrationOutcome>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  pickAvatar: () => Promise<void>;
  clearAvatar: () => Promise<void>;
  refreshTailscale: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const HYDRATE_TIMEOUT_MS = 5_000;

const fallbackRuntimeInfo: RuntimeInfo = {
  appName: APP_NAME,
  version: "0.0.0",
  platform: typeof navigator === "undefined" ? "unknown" : navigator.platform,
};

const fallbackSettings: AppSettings = {
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: true,
  reduceMotion: false,
  launchOnStartup: false,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  globalMuteShortcut: "CommandOrControl+Shift+M",
  pushToTalkShortcut: "Space",
  isNoiseSuppressionEnabled: true,
  isPushToTalkEnabled: false,
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

  return withTimeout(
    desktopApi.profile.readAvatar(avatarPath),
    "avatar_read_timeout",
    3_000,
  );
};

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: undefined,
  runtimeInfo: undefined,
  tailscaleStatus: fallbackTailscaleStatus,
  avatarDataUrl: undefined,
  isHydrating: true,
  hydrate: async () => {
    set({ isHydrating: true });

    let mode: HydrationOutcome["mode"] = "ready";
    let issue: HydrationOutcome["issue"];

    const runtimeInfo = await withTimeout(
      desktopApi.app.getRuntimeInfo(),
      "runtime_info_timeout",
      3_000,
    ).catch(async (error) => {
      await writeRendererLog("app", "warn", "Falling back to runtime info", {
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
      await writeRendererLog("app", "error", "Failed to hydrate settings", {
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
        await writeRendererLog("app", "warn", "Failed to read local avatar", {
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

    const tailscaleStatus = await withTimeout(
      desktopApi.tailscale.checkStatus(),
      "tailscale_timeout",
      4_000,
    ).catch(async (error) => {
      await writeRendererLog("tailscale", "warn", "Failed to read Tailscale status", {
        error: error instanceof Error ? error.message : String(error),
      });
      return fallbackTailscaleStatus;
    });

    set({
      runtimeInfo,
      settings,
      tailscaleStatus,
      avatarDataUrl,
      isHydrating: false,
    });

    await desktopApi.shortcuts
      .configureMute(settings.globalMuteShortcut)
      .catch(async (error) => {
        await writeRendererLog("app", "warn", "Failed to configure mute shortcut", {
          error: error instanceof Error ? error.message : String(error),
        });
      });

    await writeRendererLog("app", "info", "Renderer hydrated settings", {
      platform: runtimeInfo.platform,
      tailscaleState: tailscaleStatus.state,
      hasAvatar: Boolean(settings.avatarPath),
      profileReady: settings.hasCompletedProfileSetup,
      mode,
    });

    return {
      mode,
      issue,
    };
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

    const settings = await desktopApi.settings.save({
      avatarPath: selection.avatarPath,
    });

    set({
      settings,
      avatarDataUrl: selection.avatarDataUrl,
    });
  },
  clearAvatar: async () => {
    const avatarPath = get().settings?.avatarPath;
    await desktopApi.profile.clearAvatar(avatarPath);
    const settings = await desktopApi.settings.save({
      avatarPath: undefined,
    });
    set({
      settings,
      avatarDataUrl: undefined,
    });
  },
  refreshTailscale: async () => {
    const tailscaleStatus = await desktopApi.tailscale
      .checkStatus()
      .catch(async (error) => {
        await writeRendererLog("tailscale", "warn", "Failed to refresh Tailscale status", {
          error: error instanceof Error ? error.message : String(error),
        });
        return fallbackTailscaleStatus;
      });
    set({ tailscaleStatus });
    await writeRendererLog("tailscale", "info", "Refreshed Tailscale status", {
      state: tailscaleStatus.state,
      ip: tailscaleStatus.ip,
      magicDnsName: tailscaleStatus.magicDnsName,
    });
  },
  resetSettings: async () => {
    const settings = await desktopApi.settings.reset();
    set({ settings, avatarDataUrl: undefined });
    await get().refreshTailscale();
  },
}));
