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
  });

  assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(result.settings.nickname, "阿北");
  assert.equal(result.settings.globalMuteShortcut, "Ctrl+Shift+M");
  assert.equal(result.settings.preferredSampleRate, "auto");
  assert.equal(result.settings.inputLevelThreshold, defaultSettings.inputLevelThreshold);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal(result.migrated, true);
});
