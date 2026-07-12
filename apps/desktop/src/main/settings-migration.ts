import {
  DEFAULT_ROOM_NAME,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  isBuiltInAvatarId,
  type AppSettings,
  type MicEqualizerGains,
} from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

export type RawSettings = Partial<AppSettings> &
  Record<string, unknown> & {
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
  reduceTransparency: false,
  increaseContrast: false,
  uiScale: 100,
  launchOnStartup: false,
  isHardwareAccelerationEnabled: true,
  isOverlayEnabled: true,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  preferredSampleRate: "32000",
  inputLevelThreshold: 0.4,
  micEqualizerGains: [0, 0, 0, 0, 0],
  lowCutFrequency: "90",
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  recordingMarkerShortcut: "F8",
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isAutoGainControlEnabled: true,
  isPushToTalkEnabled: false,
  micMonitorMode: "processed",
  relayServerUrl: "",
  memberVolumes: {},
  soundVolume: 0.72,
  screenShareQuality: "smooth",
  screenShareFitMode: "contain",
  isScreenShareSystemAudioEnabled: true,
  isSystemNotificationEnabled: true,
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

const normalizeScreenShareQuality = (value?: string): AppSettings["screenShareQuality"] =>
  value === "balanced" || value === "clear" ? value : "smooth";

const normalizeScreenShareFitMode = (value?: string): AppSettings["screenShareFitMode"] =>
  value === "cover" ? "cover" : "contain";

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
    reduceMotion: normalizeBoolean(raw.reduceMotion, defaultSettings.reduceMotion),
    reduceTransparency: normalizeBoolean(
      raw.reduceTransparency,
      defaultSettings.reduceTransparency,
    ),
    increaseContrast: normalizeBoolean(raw.increaseContrast, defaultSettings.increaseContrast),
    uiScale: raw.uiScale === 110 || raw.uiScale === 125 ? raw.uiScale : 100,
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
    soundVolume:
      typeof raw.soundVolume === "number" && Number.isFinite(raw.soundVolume)
        ? Math.max(0, Math.min(1, raw.soundVolume))
        : defaultSettings.soundVolume,
    screenShareQuality: normalizeScreenShareQuality(trimUnknownText(raw.screenShareQuality)),
    screenShareFitMode: normalizeScreenShareFitMode(trimUnknownText(raw.screenShareFitMode)),
    isScreenShareSystemAudioEnabled: normalizeBoolean(
      raw.isScreenShareSystemAudioEnabled,
      defaultSettings.isScreenShareSystemAudioEnabled,
    ),
    isSystemNotificationEnabled: normalizeBoolean(
      raw.isSystemNotificationEnabled,
      defaultSettings.isSystemNotificationEnabled,
    ),
    preferredSampleRate: normalizeSampleRate(
      trimUnknownText(raw.preferredSampleRate),
      previousVersion,
    ),
    micEqualizerGains: normalizeEqualizerGains(raw.micEqualizerGains),
    lowCutFrequency: normalizeLowCutFrequency(raw),
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
