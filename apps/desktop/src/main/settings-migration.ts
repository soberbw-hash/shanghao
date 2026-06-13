import {
  DEFAULT_ROOM_NAME,
  SETTINGS_SCHEMA_VERSION,
  type AppSettings,
} from "@private-voice/shared";

import { normalizeRelayServerUrl } from "./relay-url";

export type RawSettings = Partial<AppSettings> & {
  settingsSchemaVersion?: number;
};

export const defaultSettings: AppSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: false,
  reduceMotion: false,
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
  connectionMode: "cloudflare_tunnel",
  relayServerUrl: "",
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

export const migrateSettings = (raw: RawSettings): MigrationResult => {
  const previousVersion =
    typeof raw.settingsSchemaVersion === "number" && Number.isFinite(raw.settingsSchemaVersion)
      ? raw.settingsSchemaVersion
      : 0;

  const merged: AppSettings = {
    ...defaultSettings,
    ...raw,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    nickname: trimText(raw.nickname) ?? "",
    roomName: trimText(raw.roomName) ?? DEFAULT_ROOM_NAME,
    avatarPath: trimText(raw.avatarPath),
    globalMuteShortcut: trimText(raw.globalMuteShortcut) ?? "",
    pushToTalkShortcut: trimText(raw.pushToTalkShortcut) ?? defaultSettings.pushToTalkShortcut,
    relayServerUrl: normalizeRelayServerUrl(raw.relayServerUrl) ?? "",
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

  const isProfileReady = merged.nickname.length > 0 && Boolean(merged.avatarPath);
  merged.hasCompletedProfileSetup = Boolean(merged.hasCompletedProfileSetup) && isProfileReady;

  return {
    settings: merged,
    migrated: previousVersion !== SETTINGS_SCHEMA_VERSION,
    previousVersion,
  };
};
