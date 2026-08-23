import { randomUUID } from "node:crypto";

import {
  DEFAULT_ROOM_NAME,
  OFFICIAL_RELAY_SERVER_URL,
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
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: false,
  uiScale: 100,
  launchOnStartup: true,
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
  recordingLibraryQuotaGb: 10,
  isRecordingWasteAutoCleanupEnabled: false,
  aiAsrModel: "qwen3-asr-0.6b-force",
  aiOrganizerProvider: "cloud",
  aiRoomAskProvider: "cloud",
  aiProcessingMode: "after_game",
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
  isWorkActivityVisible: true,
  isDynamicWeatherEnabled: true,
  weatherLocationMode: "auto",
  weatherManualCity: "",
  weatherEffectMode: "standard",
  isUiSoundEnabled: true,
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

const normalizeProfileId = (value: unknown): string => {
  const candidate = trimUnknownText(value);
  return candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();
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
    avatarPath: undefined,
    hasCompletedProfileSetup: normalizeBoolean(
      raw.hasCompletedProfileSetup,
      defaultSettings.hasCompletedProfileSetup,
    ),
    minimizeToTray: normalizeBoolean(raw.minimizeToTray, defaultSettings.minimizeToTray),
    uiScale: raw.uiScale === 110 || raw.uiScale === 125 ? raw.uiScale : 100,
    launchOnStartup: normalizeBoolean(raw.launchOnStartup, defaultSettings.launchOnStartup),
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
      previousVersion < 24 && raw.recordingLibraryQuotaGb === 5
        ? 10
        : normalizeNumber(raw.recordingLibraryQuotaGb, 10, 1, 100),
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
      raw.aiAsrModel === "dolphin-cn-dialect-0.4b" ||
      raw.aiAsrModel === "cohere-transcribe-2b"
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
      raw.aiProcessingMode === "low_resource" ||
      raw.aiProcessingMode === "immediate" ||
      raw.aiProcessingMode === "manual"
        ? raw.aiProcessingMode
        : "after_game",
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
    soundVolume: normalizeNumber(raw.soundVolume, defaultSettings.soundVolume, 0, 1),
    isSystemNotificationEnabled: true,
    isGameDetectionEnabled: true,
    isWorkActivityVisible: normalizeBoolean(raw.isWorkActivityVisible, true),
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
    isUiSoundEnabled: normalizeBoolean(raw.isUiSoundEnabled, true),
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
