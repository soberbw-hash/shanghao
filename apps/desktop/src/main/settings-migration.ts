import {
  DEFAULT_ROOM_NAME,
  PROFILE_SCHEMA_VERSION,
  SETTINGS_SCHEMA_VERSION,
  isBuiltInAvatarId,
  type AppSettings,
} from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

export type RawSettings = Partial<AppSettings> & {
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
  channelAccessCode: "",
  minimizeToTray: false,
  reduceMotion: false,
  showFloatingBarOnJoin: false,
  launchOnStartup: false,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  preferredSampleRate: "auto",
  inputLevelThreshold: 0.18,
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  isNoiseSuppressionEnabled: true,
  isEchoCancellationEnabled: true,
  isAutoGainControlEnabled: true,
  isPushToTalkEnabled: false,
  micMonitorMode: "processed",
  connectionMode: "relay",
  relayServerUrl: "ws://118.25.103.107:43821",
  relayAuthToken: "",
  manualDirectHost: "",
  shouldAutoCopyInviteLink: true,
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

const normalizeSampleRate = (value?: string): AppSettings["preferredSampleRate"] =>
  value === "44100" || value === "48000" ? value : "auto";

const normalizeMonitorMode = (value?: string): AppSettings["micMonitorMode"] =>
  value === "raw" ? "raw" : "processed";

const normalizeConnectionMode = (value?: string): AppSettings["connectionMode"] =>
  value === "cloudflare_tunnel" ||
  value === "relay" ||
  value === "tailscale" ||
  value === "direct_host"
    ? value
    : defaultSettings.connectionMode;

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

  const merged: AppSettings = {
    ...defaultSettings,
    ...raw,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    profileSchemaVersion: PROFILE_SCHEMA_VERSION,
    nickname: trimText(raw.nickname) ?? "",
    roomName: trimText(raw.roomName) ?? DEFAULT_ROOM_NAME,
    avatarId: normalizeAvatarId(raw.avatarId),
    avatarPath: undefined,
    channelAccessCode: trimText(raw.channelAccessCode) ?? "",
    globalMuteShortcut: trimText(raw.globalMuteShortcut) ?? "",
    pushToTalkShortcut: trimText(raw.pushToTalkShortcut) ?? defaultSettings.pushToTalkShortcut,
    relayServerUrl: normalizeRelayServerUrl(raw.relayServerUrl) ?? defaultSettings.relayServerUrl,
    relayAuthToken: trimText(raw.relayAuthToken) ?? "",
    manualDirectHost: trimText(raw.manualDirectHost) ?? "",
    preferredSampleRate: normalizeSampleRate(raw.preferredSampleRate),
    micMonitorMode: normalizeMonitorMode(raw.micMonitorMode),
    connectionMode: normalizeConnectionMode(raw.connectionMode),
    shouldAutoCopyInviteLink: true,
    isMicOnSoundEnabled: true,
    isMicOffSoundEnabled: true,
    isMemberJoinSoundEnabled: true,
    isMemberLeaveSoundEnabled: true,
    isConnectionSoundEnabled: true,
    isUiSoundEnabled: raw.isUiSoundEnabled !== false,
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
