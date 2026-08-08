import test from "node:test";
import assert from "node:assert/strict";

import { PROFILE_SCHEMA_VERSION, SETTINGS_SCHEMA_VERSION } from "@private-voice/shared";

import { defaultSettings, migrateSettings } from "../src/main/settings-migration";

test("migrateSettings falls back to safe defaults for damaged legacy config", () => {
  const result = migrateSettings({
    nickname: "阿北",
    globalMuteShortcut: "Ctrl+Shift+M",
    preferredSampleRate: "99999" as never,
    inputLevelThreshold: -10,
    settingsSchemaVersion: 0,
    shouldAutoCopyInviteLink: false,
    channelAccessCode: "legacy-code",
    manualDirectHost: "203.0.113.8",
    isMicOnSoundEnabled: false,
    isMicOffSoundEnabled: false,
    isMemberJoinSoundEnabled: false,
    isMemberLeaveSoundEnabled: false,
    isConnectionSoundEnabled: false,
    isUiSoundEnabled: false,
    isHardwareAccelerationEnabled: "invalid" as never,
    isOverlayEnabled: "invalid" as never,
    micEqualizerGains: [99, -99, 3, Number.NaN] as never,
    colorTheme: "dark",
  });

  assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(result.settings.profileSchemaVersion, PROFILE_SCHEMA_VERSION);
  assert.match(
    result.settings.profileId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(result.settings.avatarId, "fox");
  assert.equal(result.settings.avatarPath, undefined);
  assert.equal(result.settings.nickname, "");
  assert.equal(result.settings.globalMuteShortcut, "Ctrl+Shift+M");
  assert.equal("preferredSampleRate" in result.settings, false);
  assert.equal("inputLevelThreshold" in result.settings, false);
  assert.equal(result.settings.isVoiceEnhancementEnabled, true);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal("shouldAutoCopyInviteLink" in result.settings, false);
  assert.equal("channelAccessCode" in result.settings, false);
  assert.equal("manualDirectHost" in result.settings, false);
  assert.equal("connectionMode" in result.settings, false);
  assert.equal("colorTheme" in result.settings, false);
  assert.equal("isMicOnSoundEnabled" in result.settings, false);
  assert.equal("isMicOffSoundEnabled" in result.settings, false);
  assert.equal("isMemberJoinSoundEnabled" in result.settings, false);
  assert.equal("isMemberLeaveSoundEnabled" in result.settings, false);
  assert.equal("isConnectionSoundEnabled" in result.settings, false);
  assert.equal(result.settings.isUiSoundEnabled, true);
  assert.equal(result.settings.isSystemNotificationEnabled, true);
  assert.equal(result.settings.isGameDetectionEnabled, true);
  assert.equal(result.settings.launchOnStartup, true);
  assert.equal(result.settings.lastReleaseNotesVersionSeen, undefined);
  assert.equal(result.settings.soundVolume, defaultSettings.soundVolume);
  assert.equal(result.settings.isHardwareAccelerationEnabled, true);
  assert.equal(result.settings.isOverlayEnabled, true);
  assert.deepEqual(result.settings.micEqualizerGains, [12, -12, 3, 0, 0]);
  assert.equal(result.settings.lowCutFrequency, "90");
  assert.equal(result.migrated, true);
});

test("migrateSettings preserves the release notes version already shown", () => {
  const result = migrateSettings({
    ...defaultSettings,
    lastReleaseNotesVersionSeen: "2.4.0",
  });

  assert.equal(result.settings.lastReleaseNotesVersionSeen, "2.4.0");
});

test("legacy sample-rate preferences are removed because microphone processing is fixed at 48 kHz", () => {
  for (const preferredSampleRate of ["auto", "32000", "44100", "48000"]) {
    const result = migrateSettings({
      ...defaultSettings,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      preferredSampleRate,
    });

    assert.equal("preferredSampleRate" in result.settings, false);
    assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
    assert.equal(result.migrated, true);
  }
});

test("profile identity survives settings migration and malformed ids are repaired", () => {
  const profileId = "9df995df-3724-4c85-a8ae-47278368d380";
  const preserved = migrateSettings({ ...defaultSettings, profileId });
  const repaired = migrateSettings({ ...defaultSettings, profileId: "not-a-profile-id" });

  assert.equal(preserved.settings.profileId, profileId);
  assert.notEqual(repaired.settings.profileId, "not-a-profile-id");
  assert.match(
    repaired.settings.profileId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("legacy uploaded avatar profiles are reset without clearing channel server settings", () => {
  const result = migrateSettings({
    nickname: "阿北",
    avatarPath: "C:/legacy/avatar.png",
    hasCompletedProfileSetup: true,
    relayServerUrl: "wss://voice.example.com",
    settingsSchemaVersion: 5,
  });

  assert.equal(result.settings.avatarPath, undefined);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal(result.settings.relayServerUrl, "wss://voice.example.com/");
});

test("migrateSettings normalizes relay server urls for non-technical users", () => {
  assert.equal(
    migrateSettings({ relayServerUrl: "1.2.3.4:43821" }).settings.relayServerUrl,
    "ws://1.2.3.4:43821/",
  );
  assert.equal(
    migrateSettings({ relayServerUrl: "http://1.2.3.4:43821/health" }).settings.relayServerUrl,
    "ws://1.2.3.4:43821/",
  );
  assert.equal(
    migrateSettings({ relayServerUrl: "https://relay.example.com" }).settings.relayServerUrl,
    "wss://relay.example.com/",
  );
});

test("screen sharing migration drops obsolete quality, audio, and visual settings", () => {
  const migrated = migrateSettings({
    screenShareQuality: "clear" as never,
    isScreenShareSystemAudioEnabled: true,
    screenShareFitMode: "cover",
    reduceMotion: true,
    reduceTransparency: true,
    increaseContrast: true,
  });

  assert.equal("screenShareQuality" in migrated.settings, false);
  assert.equal("isScreenShareSystemAudioEnabled" in migrated.settings, false);
  assert.equal("screenShareFitMode" in migrated.settings, false);
  assert.equal("reduceMotion" in migrated.settings, false);
  assert.equal("reduceTransparency" in migrated.settings, false);
  assert.equal("increaseContrast" in migrated.settings, false);
});
