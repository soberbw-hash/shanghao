import { randomUUID } from "node:crypto";

import {
  DEFAULT_ROOM_NAME,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  isBuiltInAvatarId,
  type AppSettings,
  type MicEqualizerGains,
} from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

export type RawSettings = Partial<AppSettings> & {
  settingsSchemaVersion?: number;
  colorTheme?: unknown;
  inputLevelThreshold?: unknown;
  isLowCutEnabled?: boolean;
  preferredSampleRate?: unknown;
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
  micEqualizerGains: [0, 0, 0, 0, 0],
  lowCutFrequency: "90",
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  recordingMarkerShortcut: "F8",
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isAutoGainControlEnabled: true,
  isVoiceEnhancementEnabled: true,
  isPushToTalkEnabled: false,
  isAutoRecordOnJoinEnabled: false,
  micMonitorMode: "processed",
  relayServerUrl: "",
  memberVolumes: {},
  soundVolume: 0.72,
  isSystemNotificationEnabled: true,
  isGameDetectionEnabled: true,
  isUiSoundEnabled: true,
  isBackgroundUpdateCheckEnabled: true,
  lastCollectionViewedAt: undefined,
  hasInitializedCollectionReadState: false,
  lastUpdateCheckAt: undefined,
  lastUpdateVersionSeen: undefined,
  lastReleaseNotesVersionSeen: undefined,
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

const normalizeMonitorMode = (value?: string): AppSettings["micMonitorMode"] =>
  value === "raw" ? "raw" : "processed";

const normalizeLowCutFrequency = (raw: RawSettings): AppSettings["lowCutFrequency"] => {
  if (
    raw.lowCutFrequency === "off" ||
    raw.lowCutFrequency === "90" ||
    raw.lowCutFrequency === "120"
  ) {
    return raw.lowCutFrequency;
  }
  if (raw.isLowCutEnabled === false) {
    return "off";
  }
  return defaultSettings.lowCutFrequency;
};

const normalizeAvatarId = (value: unknown): AppSettings["avatarId"] => {
  if (value === "penguin") return "duck";
  if (value === "dog") return "corgi";
  return isBuiltInAvatarId(value) ? value : defaultSettings.avatarId;
};

const normalizeEqualizerGains = (value: unknown): MicEqualizerGains => {
  const source = Array.isArray(value) ? value : [];
  const migratedSource =
    source.length >= 10
      ? [
          ((Number(source[0]) || 0) + (Number(source[1]) || 0) + (Number(source[2]) || 0)) / 3,
          Number(source[3]) || 0,
          Number(source[5]) || 0,
          Number(source[7]) || 0,
          ((Number(source[8]) || 0) + (Number(source[9]) || 0)) / 2,
        ]
      : source;
  return Array.from({ length: 5 }, (_, index) => {
    const gain = migratedSource[index];
    return typeof gain === "number" && Number.isFinite(gain)
      ? Math.max(-12, Math.min(12, gain))
      : 0;
  }) as MicEqualizerGains;
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
    isHardwareAccelerationEnabled: normalizeBoolean(
      raw.isHardwareAccelerationEnabled,
      defaultSettings.isHardwareAccelerationEnabled,
    ),
    isOverlayEnabled: normalizeBoolean(raw.isOverlayEnabled, defaultSettings.isOverlayEnabled),
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
    globalMuteShortcut: trimUnknownText(raw.globalMuteShortcut) ?? "",
    pushToTalkShortcut:
      trimUnknownText(raw.pushToTalkShortcut) ?? defaultSettings.pushToTalkShortcut,
    recordingMarkerShortcut:
      trimUnknownText(raw.recordingMarkerShortcut) ?? defaultSettings.recordingMarkerShortcut,
    relayServerUrl:
      normalizeRelayServerUrl(trimUnknownText(raw.relayServerUrl)) ??
      defaultSettings.relayServerUrl,
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
              .map(([name, value]) => [name.slice(0, 24), Math.max(0, Math.min(2, Number(value)))]),
          )
        : {},
    soundVolume: defaultSettings.soundVolume,
    isSystemNotificationEnabled: true,
    isGameDetectionEnabled: true,
    micEqualizerGains: normalizeEqualizerGains(raw.micEqualizerGains),
    lowCutFrequency: normalizeLowCutFrequency(raw),
    micMonitorMode: normalizeMonitorMode(trimUnknownText(raw.micMonitorMode)),
    isNoiseSuppressionEnabled: raw.isNoiseSuppressionEnabled !== false,
    isEchoCancellationEnabled: raw.isEchoCancellationEnabled !== false,
    isAutoGainControlEnabled: raw.isAutoGainControlEnabled !== false,
    isVoiceEnhancementEnabled: raw.isVoiceEnhancementEnabled !== false,
    isPushToTalkEnabled: raw.isPushToTalkEnabled === true,
    isAutoRecordOnJoinEnabled: raw.isAutoRecordOnJoinEnabled === true,
    isUiSoundEnabled: true,
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
