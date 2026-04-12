import test from "node:test";
import assert from "node:assert/strict";

import { SETTINGS_SCHEMA_VERSION } from "@private-voice/shared";

import { defaultSettings, migrateSettings } from "../src/main/settings-migration";

test("migrateSettings falls back to safe defaults for damaged legacy config", () => {
  const result = migrateSettings({
    nickname: "阿北",
    globalMuteShortcut: "Ctrl+Shift+M",
    preferredSampleRate: "99999" as never,
    inputLevelThreshold: -10,
    settingsSchemaVersion: 0,
    shouldAutoCopyInviteLink: false,
    isMicOnSoundEnabled: false,
    isMicOffSoundEnabled: false,
    isMemberJoinSoundEnabled: false,
    isMemberLeaveSoundEnabled: false,
    isConnectionSoundEnabled: false,
  });

  assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(result.settings.nickname, "阿北");
  assert.equal(result.settings.globalMuteShortcut, "Ctrl+Shift+M");
  assert.equal(result.settings.preferredSampleRate, "auto");
  assert.equal(result.settings.inputLevelThreshold, defaultSettings.inputLevelThreshold);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal(result.settings.shouldAutoCopyInviteLink, true);
  assert.equal(result.settings.isMicOnSoundEnabled, true);
  assert.equal(result.settings.isMicOffSoundEnabled, true);
  assert.equal(result.settings.isMemberJoinSoundEnabled, true);
  assert.equal(result.settings.isMemberLeaveSoundEnabled, true);
  assert.equal(result.settings.isConnectionSoundEnabled, true);
  assert.equal(result.migrated, true);
});
