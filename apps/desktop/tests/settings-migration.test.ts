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
  });

  assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(result.settings.profileSchemaVersion, PROFILE_SCHEMA_VERSION);
  assert.equal(result.settings.avatarId, "fox");
  assert.equal(result.settings.avatarPath, undefined);
  assert.equal(result.settings.nickname, "阿北");
  assert.equal(result.settings.globalMuteShortcut, "Ctrl+Shift+M");
  assert.equal(result.settings.preferredSampleRate, "32000");
  assert.equal(result.settings.inputLevelThreshold, defaultSettings.inputLevelThreshold);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal("shouldAutoCopyInviteLink" in result.settings, false);
  assert.equal("channelAccessCode" in result.settings, false);
  assert.equal("manualDirectHost" in result.settings, false);
  assert.equal("connectionMode" in result.settings, false);
  assert.equal(result.settings.isMicOnSoundEnabled, true);
  assert.equal(result.settings.isMicOffSoundEnabled, true);
  assert.equal(result.settings.isMemberJoinSoundEnabled, true);
  assert.equal(result.settings.isMemberLeaveSoundEnabled, true);
  assert.equal(result.settings.isConnectionSoundEnabled, true);
  assert.equal(result.settings.isUiSoundEnabled, false);
  assert.equal(result.settings.isHardwareAccelerationEnabled, true);
  assert.equal(result.settings.isOverlayEnabled, true);
  assert.deepEqual(result.settings.micEqualizerGains, [12, -12, 3, 0, 0]);
  assert.equal(result.settings.isLowCutEnabled, true);
  assert.equal(result.migrated, true);
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
