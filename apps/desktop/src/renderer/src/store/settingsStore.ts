import {
  APP_NAME,
  DEFAULT_ROOM_NAME,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  OFFICIAL_RELAY_SERVER_URL,
  DEFAULT_QUICK_MESSAGE_MUSIC_PRESET_ID,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_VOLUME,
  DEFAULT_AI_ASR_MODEL_ID,
  normalizeQuickMessageSlots,
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  type AppSettings,
  type RuntimeInfo,
  type UpdateCheckResult,
  type UpdateStatus,
} from "@private-voice/shared";
import { create } from "zustand";

import { desktopApi } from "../utils/desktopApi";
import { writeRendererLog } from "../utils/logger";
import {
  cancelPendingMemberVolumeSaves,
  configureMemberVolumePersistence,
  resetRuntimeMemberVolumes,
} from "../features/room/memberVolumePersistence";
import { useAppStore } from "./appStore";

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

const settingsValuesEqual = (left: unknown, right: unknown): boolean =>
  Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);

export const hasSettingsPatchChanges = (
  settings: AppSettings,
  partial: Partial<AppSettings>,
): boolean =>
  (Object.keys(partial) as Array<keyof AppSettings>).some(
    (key) => !settingsValuesEqual(settings[key], partial[key]),
  );

const fallbackRuntimeInfo: RuntimeInfo = {
  appName: APP_NAME,
  version: "0.0.0",
  platform: typeof navigator === "undefined" ? "unknown" : navigator.platform,
  // Keep room handshakes on the protocol compiled into this client even when
  // the optional runtime-info IPC call times out during startup.
  protocolVersion: APP_PROTOCOL_VERSION,
  buildNumber: APP_BUILD_NUMBER,
};

const fallbackSettings: AppSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  profileSchemaVersion: PROFILE_SCHEMA_VERSION,
  profileId: "",
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarId: "fox",
  accountAvatarPresetId: undefined,
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: false,
  isFriendOnlineNotificationEnabled: false,
  hasSeenTrayNotice: false,
  recordingClipBeforeMs: 20_000,
  recordingClipAfterMs: 8_000,
  hasDismissedRecordingClipConsent: false,
  uiScale: 100,
  isHardwareAccelerationEnabled: true,
  isOverlayEnabled: true,
  preferredInputDeviceId: undefined,
  phoneMicMode: "web",
  preferredOutputDeviceId: undefined,
  microphoneSendVolume: 1,
  speakerMasterVolume: 1,
  isFriendLoudnessBalanceEnabled: true,
  micEqualizerGains: [0, 0, 0, 0, 0],
  lowCutFrequency: "75",
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  recordingMarkerShortcut: "F8",
  recordingSaveDirectory: undefined,
  recordingLibraryQuotaGb: 20,
  isRecordingWasteAutoCleanupEnabled: false,
  aiAsrModel: DEFAULT_AI_ASR_MODEL_ID,
  aiOrganizerProvider: "cloud",
  aiRoomAskProvider: "cloud",
  aiProcessingMode: "manual",
  isAiAutoTranscribeEnabled: false,
  isAiAutoOrganizeEnabled: false,
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isAutoGainControlEnabled: true,
  isVoiceEnhancementEnabled: true,
  isPushToTalkEnabled: false,
  isAutoRecordOnJoinEnabled: true,
  micMonitorMode: "processed",
  relayServerUrl: OFFICIAL_RELAY_SERVER_URL,
  isDeveloperModeEnabled: false,
  memberVolumes: {},
  soundVolume: 0.72,
  isSystemNotificationEnabled: true,
  isGameDetectionEnabled: true,
  isDynamicWeatherEnabled: true,
  weatherLocationMode: "auto",
  weatherManualCity: "",
  isSystemWeatherLocationEnabled: false,
  weatherEffectMode: "standard",
  isUiSoundEnabled: true,
  quickMessages: {
    soundEnabled: true,
    soundVolume: DEFAULT_QUICK_MESSAGE_VOLUME,
    musicPresetId: DEFAULT_QUICK_MESSAGE_MUSIC_PRESET_ID,
    musicSlots: DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
    slots: DEFAULT_QUICK_MESSAGE_SLOTS,
  },
  isBackgroundUpdateCheckEnabled: true,
  lastCollectionViewedAt: undefined,
  collectionViewedAtByRoom: undefined,
  hasInitializedCollectionReadState: false,
  lastUpdateCheckAt: undefined,
  lastUpdateVersionSeen: undefined,
  lastReleaseNotesVersionSeen: undefined,
  lastDailyRoomReportSeen: undefined,
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

const getQuickMessageShortcutSignature = (settings: AppSettings): string =>
  [
    ...normalizeQuickMessageSlots(settings.quickMessages.slots, DEFAULT_QUICK_MESSAGE_SLOTS),
    ...normalizeQuickMessageSlots(
      settings.quickMessages.musicSlots,
      DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
      DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length,
    ),
  ]
    .map((slot) => `${slot.enabled ? "1" : "0"}:${slot.shortcut.trim().toLowerCase()}`)
    .join("|");

let unsubscribeUpdateStatus: (() => void) | undefined;

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

    unsubscribeUpdateStatus?.();
    unsubscribeUpdateStatus = desktopApi.updates.onStatus((updateStatus) => set({ updateStatus }));

    if (settings.isBackgroundUpdateCheckEnabled) {
      void get()
        .checkUpdates()
        .catch(() => undefined);
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
    const previousSettings = get().settings;
    if (previousSettings && !hasSettingsPatchChanges(previousSettings, partial)) {
      return previousSettings;
    }
    const settings = await desktopApi.settings.save(partial);
    set({ settings, avatarDataUrl: undefined });
    if (
      (typeof partial.globalMuteShortcut === "string" &&
        settings.globalMuteShortcut !== partial.globalMuteShortcut.trim()) ||
      (typeof partial.recordingMarkerShortcut === "string" &&
        settings.recordingMarkerShortcut !== partial.recordingMarkerShortcut.trim()) ||
      ("isPushToTalkEnabled" in partial &&
        settings.isPushToTalkEnabled !== partial.isPushToTalkEnabled) ||
      (typeof partial.pushToTalkShortcut === "string" &&
        settings.pushToTalkShortcut !== partial.pushToTalkShortcut.trim())
    ) {
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "快捷键未更改",
        description: "这个组合键无法注册，已保留原来的设置。",
      });
    }
    if (
      "quickMessages" in partial &&
      partial.quickMessages &&
      getQuickMessageShortcutSignature({ ...settings, quickMessages: partial.quickMessages }) !==
        getQuickMessageShortcutSignature(settings)
    ) {
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "快捷消息按键未更改",
        description: "有组合键无法注册，已保留原来的槽位设置。",
      });
    }
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
    cancelPendingMemberVolumeSaves();
    const settings = await desktopApi.settings.reset();
    set({ settings, avatarDataUrl: undefined });
    resetRuntimeMemberVolumes();
  },
}));

configureMemberVolumePersistence({
  getMemberVolumes: () => useSettingsStore.getState().settings?.memberVolumes,
  saveMemberVolumes: async (memberVolumes) => {
    try {
      await useSettingsStore.getState().saveSettings({ memberVolumes });
    } catch {
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "成员音量未保存",
        description: "音量已在本次通话生效，请稍后重试。",
      });
    }
  },
});
