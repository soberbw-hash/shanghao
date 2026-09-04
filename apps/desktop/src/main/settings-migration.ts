import { randomUUID } from "node:crypto";

import {
  DEFAULT_ROOM_NAME,
  OFFICIAL_RELAY_SERVER_URL,
  DEFAULT_QUICK_MESSAGE_MUSIC_PRESET_ID,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_VOLUME,
  normalizeQuickMessageSlots,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  isBuiltInAvatarId,
  type AppSettings,
} from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

export type RawSettings = Partial<AppSettings> & {
  settingsSchemaVersion?: number;
  colorTheme?: unknown;
  inputLevelThreshold?: unknown;
  isLowCutEnabled?: boolean;
  preferredSampleRate?: unknown;
  /** Legacy switch; recording loudness balance is now always enabled. */
  isRecordingLoudnessBalanceEnabled?: unknown;
};

export const defaultSettings: AppSettings = {
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
  uiScale: 100,
  isHardwareAccelerationEnabled: true,
  isOverlayEnabled: true,
  preferredInputDeviceId: undefined,
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
  aiAsrModel: "qwen3-asr-0.6b-force",
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
  hasInitializedCollectionReadState: false,
  lastUpdateCheckAt: undefined,
  lastUpdateVersionSeen: undefined,
  lastReleaseNotesVersionSeen: undefined,
  lastDailyRoomReportSeen: undefined,
};

export interface MigrationResult {
  settings: AppSettings;
  migrated: boolean;
  previousVersion: number;
}

const trimText = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const trimUnknownText = (value: unknown): string | undefined =>
  typeof value === "string" ? trimText(value) : undefined;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Account providers own the shape of their user ids. Supabase currently uses UUIDs,
// while CloudBase returns an opaque uid. Treat both as durable identities instead of
// regenerating a UUID every time settings are normalized.
const OPAQUE_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;

const normalizeProfileId = (value: unknown): string => {
  const candidate = trimUnknownText(value);
  return candidate && (UUID_PATTERN.test(candidate) || OPAQUE_ACCOUNT_ID_PATTERN.test(candidate))
    ? candidate
    : randomUUID();
};

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;

const normalizeAvatarId = (value: unknown): AppSettings["avatarId"] => {
  if (value === "penguin") return "duck";
  if (value === "dog") return "corgi";
  return isBuiltInAvatarId(value) ? value : defaultSettings.avatarId;
};

const normalizeAccountAvatarPresetId = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().toLowerCase();
  return /^[a-z0-9-]{1,64}$/.test(candidate) ? candidate : undefined;
};

const LEGACY_DEFAULT_QUICK_MESSAGE_VOLUME = 0.72;

const normalizeQuickMessages = (
  value: unknown,
  previousSettingsVersion: number,
): AppSettings["quickMessages"] => {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const slots = normalizeQuickMessageSlots(raw.slots);
  const normalizedSlots = slots.map((slot) =>
    slot.presetId === "legacy-ok" ? { ...slot, presetId: undefined, enabled: false } : slot,
  );
  const rawMusicPresetId =
    typeof raw.musicPresetId === "string" ? raw.musicPresetId.trim() || undefined : undefined;
  const rawMusicSlots = Array.isArray(raw.musicSlots) ? raw.musicSlots : [];
  const musicSlots = Array.from(
    { length: DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length },
    (_, index) => {
      const fallback = DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[index] ??
        DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[0] ?? {
          presetId: undefined,
          shortcut: "",
          enabled: false,
        };
      const candidate = rawMusicSlots[index];
      const source =
        candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>)
          : {};
      return {
        presetId:
          typeof source.presetId === "string"
            ? source.presetId.trim() || undefined
            : index === 0
              ? (rawMusicPresetId ?? fallback.presetId)
              : fallback.presetId,
        shortcut: typeof source.shortcut === "string" ? source.shortcut.trim() : fallback.shortcut,
        enabled: normalizeBoolean(source.enabled, fallback.enabled),
      };
    },
  );
  const normalizedSoundVolume = normalizeNumber(
    raw.soundVolume,
    defaultSettings.quickMessages.soundVolume,
    0,
    1,
  );
  const soundVolume =
    previousSettingsVersion < 35 && normalizedSoundVolume === LEGACY_DEFAULT_QUICK_MESSAGE_VOLUME
      ? DEFAULT_QUICK_MESSAGE_VOLUME
      : normalizedSoundVolume;

  return {
    soundEnabled: normalizeBoolean(raw.soundEnabled, defaultSettings.quickMessages.soundEnabled),
    soundVolume,
    musicPresetId: rawMusicPresetId ?? defaultSettings.quickMessages.musicPresetId,
    musicSlots,
    slots: normalizedSlots,
  };
};

export const migrateSettings = (raw: RawSettings): MigrationResult => {
  const previousVersion =
    typeof raw.settingsSchemaVersion === "number" && Number.isFinite(raw.settingsSchemaVersion)
      ? raw.settingsSchemaVersion
      : 0;
  const previousProfileVersion =
    typeof raw.profileSchemaVersion === "number" && Number.isFinite(raw.profileSchemaVersion)
      ? raw.profileSchemaVersion
      : 0;

  const merged: AppSettings = {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    profileId: normalizeProfileId(raw.profileId),
    nickname:
      previousProfileVersion === PROFILE_SCHEMA_VERSION ? (trimText(raw.nickname) ?? "") : "",
    roomName: trimText(raw.roomName) ?? DEFAULT_ROOM_NAME,
    avatarId: normalizeAvatarId(raw.avatarId),
    accountAvatarPresetId: normalizeAccountAvatarPresetId(raw.accountAvatarPresetId),
    avatarPath: undefined,
    hasCompletedProfileSetup: normalizeBoolean(
      raw.hasCompletedProfileSetup,
      defaultSettings.hasCompletedProfileSetup,
    ),
    minimizeToTray: normalizeBoolean(raw.minimizeToTray, defaultSettings.minimizeToTray),
    uiScale: raw.uiScale === 110 || raw.uiScale === 125 ? raw.uiScale : 100,
    isHardwareAccelerationEnabled: true,
    isOverlayEnabled: true,
    preferredInputDeviceId: trimUnknownText(raw.preferredInputDeviceId),
    preferredOutputDeviceId: trimUnknownText(raw.preferredOutputDeviceId),
    microphoneSendVolume: normalizeNumber(
      raw.microphoneSendVolume,
      defaultSettings.microphoneSendVolume,
      0.5,
      1.5,
    ),
    speakerMasterVolume: normalizeNumber(
      raw.speakerMasterVolume,
      defaultSettings.speakerMasterVolume,
      0,
      2,
    ),
    isFriendLoudnessBalanceEnabled: normalizeBoolean(
      raw.isFriendLoudnessBalanceEnabled,
      defaultSettings.isFriendLoudnessBalanceEnabled,
    ),
    globalMuteShortcut: "",
    pushToTalkShortcut:
      trimUnknownText(raw.pushToTalkShortcut) ?? defaultSettings.pushToTalkShortcut,
    recordingMarkerShortcut:
      trimUnknownText(raw.recordingMarkerShortcut) ?? defaultSettings.recordingMarkerShortcut,
    recordingSaveDirectory: trimUnknownText(raw.recordingSaveDirectory),
    recordingLibraryQuotaGb:
      (previousVersion < 24 && raw.recordingLibraryQuotaGb === 5) ||
      (previousVersion < 33 && raw.recordingLibraryQuotaGb === 10)
        ? 20
        : normalizeNumber(
            raw.recordingLibraryQuotaGb,
            defaultSettings.recordingLibraryQuotaGb,
            1,
            100,
          ),
    isRecordingWasteAutoCleanupEnabled: normalizeBoolean(
      raw.isRecordingWasteAutoCleanupEnabled,
      false,
    ),
    aiAsrModel:
      raw.aiAsrModel === "qwen3-asr-1.7b-force" ||
      raw.aiAsrModel === "qwen3-asr-0.6b-force" ||
      raw.aiAsrModel === "fun-asr-nano-2512" ||
      raw.aiAsrModel === "glm-asr-nano-2512" ||
      raw.aiAsrModel === "fireredasr2-aed" ||
      raw.aiAsrModel === "paraformer-zh" ||
      raw.aiAsrModel === "moss-transcribe-diarize-0.9b" ||
      raw.aiAsrModel === "moss-transcribe-diarize-0.9b-q8_0" ||
      raw.aiAsrModel === "dolphin-cn-dialect-0.4b" ||
      raw.aiAsrModel === "cohere-transcribe-2b" ||
      raw.aiAsrModel === "ark-asr-3b-q8_0"
        ? raw.aiAsrModel
        : raw.aiAsrModel === "qwen3-asr-0.6b"
          ? "qwen3-asr-0.6b-force"
          : "qwen3-asr-0.6b-force",
    aiOrganizerProvider:
      raw.aiOrganizerProvider === "local" || raw.aiOrganizerProvider === "custom"
        ? raw.aiOrganizerProvider
        : "cloud",
    // Room Ask is a shared cloud capability. Legacy local/custom selections
    // must not make friends download Qwen before they can ask a question.
    aiRoomAskProvider: "cloud",
    aiProcessingMode:
      previousVersion < 35 &&
      raw.aiProcessingMode === "after_game" &&
      normalizeBoolean(raw.isAiAutoTranscribeEnabled, false) === false
        ? "manual"
        : raw.aiProcessingMode === "after_game" ||
            raw.aiProcessingMode === "low_resource" ||
            raw.aiProcessingMode === "immediate" ||
            raw.aiProcessingMode === "manual"
          ? raw.aiProcessingMode
          : "manual",
    isAiAutoTranscribeEnabled: normalizeBoolean(raw.isAiAutoTranscribeEnabled, false),
    isAiAutoOrganizeEnabled: normalizeBoolean(raw.isAiAutoOrganizeEnabled, false),
    relayServerUrl:
      normalizeRelayServerUrl(trimUnknownText(raw.relayServerUrl)) ??
      defaultSettings.relayServerUrl,
    isDeveloperModeEnabled: normalizeBoolean(raw.isDeveloperModeEnabled, false),
    memberVolumes:
      raw.memberVolumes &&
      typeof raw.memberVolumes === "object" &&
      !Array.isArray(raw.memberVolumes)
        ? Object.fromEntries(
            Object.entries(raw.memberVolumes)
              .filter(
                ([name, value]) =>
                  name.trim() && typeof value === "number" && Number.isFinite(value),
              )
              .slice(0, 50)
              .map(([name, value]) => [name.slice(0, 24), Math.max(0, Math.min(3, Number(value)))]),
          )
        : {},
    soundVolume: defaultSettings.soundVolume,
    isSystemNotificationEnabled: true,
    isGameDetectionEnabled: true,
    isDynamicWeatherEnabled: normalizeBoolean(raw.isDynamicWeatherEnabled, true),
    weatherLocationMode: raw.weatherLocationMode === "manual" ? "manual" : "auto",
    weatherManualCity: trimUnknownText(raw.weatherManualCity) ?? "",
    // Visual weather has one complete presentation. Keep the legacy field for
    // settings compatibility, but never migrate users into a reduced tier.
    weatherEffectMode: "standard",
    micEqualizerGains: [0, 0, 0, 0, 0],
    lowCutFrequency: "75",
    micMonitorMode: "processed",
    isNoiseSuppressionEnabled: raw.isNoiseSuppressionEnabled !== false,
    isEchoCancellationEnabled: raw.isEchoCancellationEnabled !== false,
    isAutoGainControlEnabled: raw.isAutoGainControlEnabled !== false,
    isVoiceEnhancementEnabled: raw.isVoiceEnhancementEnabled !== false,
    isPushToTalkEnabled: raw.isPushToTalkEnabled === true,
    isAutoRecordOnJoinEnabled: normalizeBoolean(raw.isAutoRecordOnJoinEnabled, true),
    isUiSoundEnabled: true,
    quickMessages: normalizeQuickMessages(raw.quickMessages, previousVersion),
    isBackgroundUpdateCheckEnabled: raw.isBackgroundUpdateCheckEnabled !== false,
    lastCollectionViewedAt: trimUnknownText(raw.lastCollectionViewedAt),
    hasInitializedCollectionReadState: raw.hasInitializedCollectionReadState === true,
    isAutoDownloadUpdateEnabled:
      typeof raw.isAutoDownloadUpdateEnabled === "boolean"
        ? raw.isAutoDownloadUpdateEnabled
        : defaultSettings.isAutoDownloadUpdateEnabled,
    isAutoInstallUpdateEnabled:
      typeof raw.isAutoInstallUpdateEnabled === "boolean"
        ? raw.isAutoInstallUpdateEnabled
        : defaultSettings.isAutoInstallUpdateEnabled,
    lastUpdateCheckAt: trimUnknownText(raw.lastUpdateCheckAt),
    lastUpdateVersionSeen: trimUnknownText(raw.lastUpdateVersionSeen),
    lastReleaseNotesVersionSeen: trimUnknownText(raw.lastReleaseNotesVersionSeen),
    lastDailyRoomReportSeen:
      raw.lastDailyRoomReportSeen && typeof raw.lastDailyRoomReportSeen === "object"
        ? {
            main: trimUnknownText(raw.lastDailyRoomReportSeen.main),
            side: trimUnknownText(raw.lastDailyRoomReportSeen.side),
          }
        : undefined,
  };

  const isProfileReady = merged.nickname.length > 0 && isBuiltInAvatarId(merged.avatarId);
  merged.hasCompletedProfileSetup =
    !raw.avatarPath &&
    previousProfileVersion === PROFILE_SCHEMA_VERSION &&
    Boolean(merged.hasCompletedProfileSetup) &&
    isProfileReady;

  return {
    settings: merged,
    migrated: previousVersion !== SETTINGS_SCHEMA_VERSION || Boolean(raw.avatarPath),
    previousVersion,
  };
};
