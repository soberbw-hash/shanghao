import { createRoot } from "react-dom/client";
import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
} from "@private-voice/shared";
import type {
  AppSettings,
  DesktopApi,
  RendererDiagnosticsSummary,
  RuntimeInfo,
} from "@private-voice/shared";

import { SETTINGS_SECTION_REQUEST_KEY } from "../../src/renderer/src/features/settings/settingsSectionState";
import "../../src/renderer/src/styles/index.css";

const actions = document.documentElement.dataset;
const settings = {
  avatarId: "fox",
  minimizeToTray: false,
  interfaceSoundVolume: 0,
  weatherManualCity: "",
  weatherLocationMode: "auto",
  preferredInputDeviceId: "",
  preferredOutputDeviceId: "",
  memberVolumes: {},
  recordingLibraryQuotaGb: 20,
  recordingMarkerShortcut: "F8",
  aiOrganizerProvider: "cloud",
  aiTranscriptionProvider: "cloud",
  quickMessages: {
    slots: DEFAULT_QUICK_MESSAGE_SLOTS,
    musicSlots: DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
    soundEnabled: true,
    soundVolume: 50,
  },
} as AppSettings;
let removed = false;
window.desktopApi = {
  app: { writeLog: async () => undefined },
  ai: {
    getSnapshot: async () => ({ models: [], scheduler: { gameActive: false } }),
    getCustomProvider: async () => ({ configured: false, hasApiKey: false }),
    getTranscriptionProvider: async () => ({ cloudConfigured: true, customConfigured: false }),
    onStatus: () => () => undefined,
    onVoiceMemoryStatus: () => () => undefined,
    listVoiceMemories: async () => [],
  },
  windows: {
    getStatus: async () => ({ firewall: {}, iconOverlays: {} }),
  },
  weather: { getSnapshot: async () => ({ source: "fallback" }) },
  recording: { list: async () => ({ items: [], totalBytes: 0, directory: "" }) },
  diagnostics: {
    exportBundle: async (summary?: RendererDiagnosticsSummary) => {
      actions.exported = summary?.roomLifecycleState;
      return {};
    },
  },
  settings: {
    reset: async () => {
      actions.reset = "true";
      return settings;
    },
  },
  storage: {
    inspect: async () => {
      actions.inspected = "true";
      return [
        { category: "models", bytes: 2 * 1024 ** 3, files: 3, complete: true },
        {
          category: "temporary",
          bytes: removed ? 0 : 4 * 1024 ** 2,
          files: removed ? 0 : 2,
          complete: true,
        },
      ];
    },
    clearExpiredTemporary: async () => {
      actions.cleaned = "true";
      removed = true;
      return { removed: 2, removedBytes: 4 * 1024 ** 2 };
    },
  },
} as unknown as DesktopApi;
window.confirm = () => {
  actions.confirmed = "true";
  return actions.allowReset === "true";
};
sessionStorage.setItem(SETTINGS_SECTION_REQUEST_KEY, "diagnostics");
const { useSettingsStore } = await import("../../src/renderer/src/store/settingsStore");
const { SettingsPage } = await import("../../src/renderer/src/pages/SettingsPage");
const { useAccountStore } = await import("../../src/renderer/src/store/accountStore");
useAccountStore.setState({ snapshot: { status: "guest", configured: true, guestAllowed: true } });
useSettingsStore.setState({
  settings,
  runtimeInfo: { version: "3.4.23" } as RuntimeInfo,
  updateStatus: { ...useSettingsStore.getState().updateStatus, message: "当前已经是最新版本" },
});
createRoot(document.getElementById("root")!).render(<SettingsPage />);
