import { TailscaleState, type AppSettings, type RuntimeInfo, type TailscaleStatus } from "@private-voice/shared";
import { create } from "zustand";

import { desktopApi } from "../utils/desktopApi";
import { writeRendererLog } from "../utils/logger";

interface SettingsStoreState {
  runtimeInfo?: RuntimeInfo;
  settings?: AppSettings;
  tailscaleStatus?: TailscaleStatus;
  isHydrating: boolean;
  hydrate: () => Promise<void>;
  saveSettings: (partial: Partial<AppSettings>) => Promise<void>;
  refreshTailscale: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const fallbackTailscaleStatus: TailscaleStatus = {
  state: TailscaleState.Unknown,
  isInstalled: false,
  isConnected: false,
  message: "Checking Tailscale status...",
};

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: undefined,
  runtimeInfo: undefined,
  tailscaleStatus: fallbackTailscaleStatus,
  isHydrating: true,
  hydrate: async () => {
    set({ isHydrating: true });

    const [runtimeInfo, settings, tailscaleStatus] = await Promise.all([
      desktopApi.app.getRuntimeInfo(),
      desktopApi.settings.get(),
      desktopApi.tailscale.checkStatus(),
    ]);

    set({
      runtimeInfo,
      settings,
      tailscaleStatus,
      isHydrating: false,
    });

    await desktopApi.shortcuts.configureMute(settings.globalMuteShortcut);
    await writeRendererLog("app", "info", "Renderer hydrated settings", {
      platform: runtimeInfo.platform,
      tailscaleState: tailscaleStatus.state,
    });
  },
  saveSettings: async (partial) => {
    const settings = await desktopApi.settings.save(partial);
    set({ settings });
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
    set({ settings });
    await get().refreshTailscale();
  },
}));
