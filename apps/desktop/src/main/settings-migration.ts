import {
  DEFAULT_ROOM_NAME,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  isBuiltInAvatarId,
  type AppSettings,
  type MicEqualizerGains,
} from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

export type RawSettings = Partial<AppSettings> & Record<string, unknown> & {
  settingsSchemaVersion?: number;
};

export const defaultSettings: AppSettings = {
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
  preferredSampleRate: "32000",
  inputLevelThreshold: 0.4,
  micEqualizerGains: [0, 0, 0, 0, 0],
  isLowCutEnabled: true,
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

const normalizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeSampleRate = (
  value: string | undefined,
  previousVersion: number,
): AppSettings["preferredSampleRate"] => {
  if (previousVersion < 10 && (!value || value === "auto")) {
    return "32000";
  }
  if (value === "auto" || value === "32000" || value === "44100" || value === "48000") {
    return value;
  }
  return defaultSettings.preferredSampleRate;
};

const normalizeMonitorMode = (value?: string): AppSettings["micMonitorMode"] =>
  value === "raw" ? "raw" : "processed";

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

  const merged: AppSettings = {
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    nickname: trimText(raw.nickname) ?? "",
    roomName: trimText(raw.roomName) ?? DEFAULT_ROOM_NAME,
    avatarId: normalizeAvatarId(raw.avatarId),
    avatarPath: undefined,
    hasCompletedProfileSetup: normalizeBoolean(
      raw.hasCompletedProfileSetup,
      defaultSettings.hasCompletedProfileSetup,
    ),
    minimizeToTray: normalizeBoolean(raw.minimizeToTray, defaultSettings.minimizeToTray),
    reduceMotion: normalizeBoolean(raw.reduceMotion, defaultSettings.reduceMotion),
    launchOnStartup: normalizeBoolean(raw.launchOnStartup, defaultSettings.launchOnStartup),
    isHardwareAccelerationEnabled: normalizeBoolean(
      raw.isHardwareAccelerationEnabled,
      defaultSettings.isHardwareAccelerationEnabled,
    ),
    isOverlayEnabled: normalizeBoolean(raw.isOverlayEnabled, defaultSettings.isOverlayEnabled),
    preferredInputDeviceId: trimUnknownText(raw.preferredInputDeviceId),
    preferredOutputDeviceId: trimUnknownText(raw.preferredOutputDeviceId),
    globalMuteShortcut: trimUnknownText(raw.globalMuteShortcut) ?? "",
    pushToTalkShortcut:
      trimUnknownText(raw.pushToTalkShortcut) ?? defaultSettings.pushToTalkShortcut,
    relayServerUrl:
      normalizeRelayServerUrl(trimUnknownText(raw.relayServerUrl)) ?? defaultSettings.relayServerUrl,
    preferredSampleRate: normalizeSampleRate(
      trimUnknownText(raw.preferredSampleRate),
      previousVersion,
    ),
    micEqualizerGains: normalizeEqualizerGains(raw.micEqualizerGains),
    isLowCutEnabled: normalizeBoolean(raw.isLowCutEnabled, defaultSettings.isLowCutEnabled),
    micMonitorMode: normalizeMonitorMode(trimUnknownText(raw.micMonitorMode)),
    isNoiseSuppressionEnabled: raw.isNoiseSuppressionEnabled !== false,
    isEchoCancellationEnabled: raw.isEchoCancellationEnabled !== false,
    isAutoGainControlEnabled: raw.isAutoGainControlEnabled !== false,
    isPushToTalkEnabled: raw.isPushToTalkEnabled === true,
    isMicOnSoundEnabled: true,
    isMicOffSoundEnabled: true,
    isMemberJoinSoundEnabled: true,
    isMemberLeaveSoundEnabled: true,
    isConnectionSoundEnabled: true,
    isUiSoundEnabled: raw.isUiSoundEnabled !== false,
    isBackgroundUpdateCheckEnabled: raw.isBackgroundUpdateCheckEnabled !== false,
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
    inputLevelThreshold:
      typeof raw.inputLevelThreshold === "number" && raw.inputLevelThreshold > 0
        ? Math.min(1, raw.inputLevelThreshold)
        : defaultSettings.inputLevelThreshold,
  };

  const previousProfileVersion =
    typeof raw.profileSchemaVersion === "number" && Number.isFinite(raw.profileSchemaVersion)
      ? raw.profileSchemaVersion
      : 0;
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
