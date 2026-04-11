import {
  TailscaleState,
  type AppSettings,
  type RuntimeInfo,
  type TailscaleStatus,
} from "@private-voice/shared";
import { create } from "zustand";

import { desktopApi } from "../utils/desktopApi";
import { writeRendererLog } from "../utils/logger";

interface SettingsStoreState {
  runtimeInfo?: RuntimeInfo;
  settings?: AppSettings;
  tailscaleStatus?: TailscaleStatus;
  avatarDataUrl?: string;
  isHydrating: boolean;
  hydrate: () => Promise<void>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  pickAvatar: () => Promise<void>;
  clearAvatar: () => Promise<void>;
  refreshTailscale: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const fallbackTailscaleStatus: TailscaleStatus = {
  state: TailscaleState.Unknown,
  isInstalled: false,
  isConnected: false,
  message: "正在检测 Tailscale 状态…",
};

const loadAvatarDataUrl = async (avatarPath?: string): Promise<string | undefined> => {
  if (!avatarPath) {
    return undefined;
  }

  return desktopApi.profile.readAvatar(avatarPath);
};

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: undefined,
  runtimeInfo: undefined,
  tailscaleStatus: fallbackTailscaleStatus,
  avatarDataUrl: undefined,
  isHydrating: true,
  hydrate: async () => {
    set({ isHydrating: true });

    const [runtimeInfo, settings, tailscaleStatus] = await Promise.all([
      desktopApi.app.getRuntimeInfo(),
      desktopApi.settings.get(),
      desktopApi.tailscale.checkStatus(),
    ]);
    const avatarDataUrl = await loadAvatarDataUrl(settings.avatarPath);

    set({
      runtimeInfo,
      settings,
      tailscaleStatus,
      avatarDataUrl,
      isHydrating: false,
    });

    await desktopApi.shortcuts.configureMute(settings.globalMuteShortcut);
    await writeRendererLog("app", "info", "Renderer hydrated settings", {
      platform: runtimeInfo.platform,
      tailscaleState: tailscaleStatus.state,
      hasAvatar: Boolean(settings.avatarPath),
      profileReady: settings.hasCompletedProfileSetup,
    });
  },
  saveSettings: async (partial) => {
    const settings = await desktopApi.settings.save(partial);
    const avatarDataUrl = await loadAvatarDataUrl(settings.avatarPath);
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
    const tailscaleStatus = await desktopApi.tailscale.checkStatus();
    set({ tailscaleStatus });
    await writeRendererLog("tailscale", "info", "Refreshed Tailscale status", {
      state: tailscaleStatus.state,
      ip: tailscaleStatus.ip,
    });
  },
  resetSettings: async () => {
    const settings = await desktopApi.settings.reset();
    set({ settings, avatarDataUrl: undefined });
    await get().refreshTailscale();
  },
}));
