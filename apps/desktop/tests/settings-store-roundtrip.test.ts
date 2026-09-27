import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SETTINGS_SCHEMA_VERSION } from "@private-voice/shared";

import { defaultSettings, migrateSettings } from "../src/main/settings-migration";
import { SettingsStore } from "../src/main/settings-store";

test("opening current settings leaves the primary file and backup untouched", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-settings-read-"));
  try {
    const settings = migrateSettings({ ...defaultSettings, profileId: randomUUID() }).settings;
    const filePath = path.join(directory, "settings.json");
    const original = JSON.stringify(settings, null, 2);
    await writeFile(filePath, original);

    const store = new SettingsStore(undefined, directory);
    assert.deepEqual(await store.load(), settings);
    assert.equal(await readFile(filePath, "utf8"), original);
    await assert.rejects(readFile(path.join(directory, "settings.backup.json"), "utf8"), {
      code: "ENOENT",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("user settings survive save and a fresh store load", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-settings-roundtrip-"));
  try {
    const store = new SettingsStore(undefined, directory);
    await store.load();
    const saved = await store.save({
      nickname: "阿北",
      preferredInputDeviceId: "test-input",
      preferredOutputDeviceId: "test-output",
      recordingSaveDirectory: "D:/上号录音",
      isBackgroundUpdateCheckEnabled: false,
      quickMessages: {
        ...store.getSnapshot().quickMessages,
        soundVolume: 0.42,
        slots: store
          .getSnapshot()
          .quickMessages.slots.map((slot, index) =>
            index === 7 ? { ...slot, presetId: "legacy-hear", enabled: true } : slot,
          ),
        musicSlots: store.getSnapshot().quickMessages.musicSlots.map((slot, index) =>
          index === 4
            ? {
                ...slot,
                presetId: defaultSettings.quickMessages.musicSlots[0]?.presetId,
                enabled: true,
              }
            : slot,
        ),
      },
    });

    const reloaded = await new SettingsStore(undefined, directory).load();
    assert.deepEqual(reloaded, saved);
    assert.equal(reloaded.recordingSaveDirectory, "D:/上号录音");
    assert.equal(reloaded.quickMessages.soundVolume, 0.42);
    assert.equal(reloaded.quickMessages.slots[7]?.presetId, "legacy-hear");
    assert.equal(
      reloaded.quickMessages.musicSlots[4]?.presetId,
      defaultSettings.quickMessages.musicSlots[0]?.presetId,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("settings migration is idempotent for an N-1 version fixture", () => {
  const oldSettings = {
    ...defaultSettings,
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
    profileId: randomUUID(),
    nickname: "阿北",
    preferredInputDeviceId: "test-input",
    recordingSaveDirectory: "D:/上号录音",
  };
  const first = migrateSettings(oldSettings).settings;
  const second = migrateSettings(first).settings;
  assert.deepEqual(second, first);
  assert.equal(first.nickname, "阿北");
  assert.equal(first.preferredInputDeviceId, "test-input");
  assert.equal(first.recordingSaveDirectory, "D:/上号录音");
});
