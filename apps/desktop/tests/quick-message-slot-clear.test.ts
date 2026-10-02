import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { getQuickMessageShortcutSlots, normalizeQuickMessageSlots } from "@private-voice/shared";
import { defaultSettings, migrateSettings } from "../src/main/settings-migration";

test("cleared voice and music slots remain empty after JSON persistence and migration", () => {
  const settings = structuredClone(defaultSettings);
  const voiceKey = settings.quickMessages.slots[2].shortcut;
  const musicKey = settings.quickMessages.musicSlots[0].shortcut;
  settings.quickMessages.slots[2] = {
    ...settings.quickMessages.slots[2],
    presetId: undefined,
    enabled: false,
  };
  settings.quickMessages.musicSlots[0] = {
    ...settings.quickMessages.musicSlots[0],
    presetId: undefined,
    enabled: false,
  };
  settings.quickMessages.musicPresetId = undefined;
  const saved = JSON.parse(JSON.stringify(settings));
  const restored = migrateSettings(saved).settings;
  assert.equal(restored.quickMessages.slots.length, 8);
  assert.equal(restored.quickMessages.musicSlots.length, 5);
  assert.equal(restored.quickMessages.slots[2].presetId, undefined);
  assert.equal(restored.quickMessages.musicSlots[0].presetId, undefined);
  assert.equal(restored.quickMessages.slots[2].shortcut, voiceKey);
  assert.equal(restored.quickMessages.musicSlots[0].shortcut, musicKey);
  assert.equal(restored.quickMessages.slots[2].enabled, false);
  assert.equal(restored.quickMessages.musicSlots[0].enabled, false);
  assert.deepEqual(restored.quickMessages.slots[3], settings.quickMessages.slots[3]);
});

test("empty slots do not register keys and can be rebound at the same index", () => {
  const settings = structuredClone(defaultSettings.quickMessages);
  settings.shortcutsEnabled = true;
  const previous = settings.slots[1];
  settings.slots[1] = { ...previous, presetId: undefined, enabled: false };
  const runtime = getQuickMessageShortcutSlots(settings);
  assert.equal(runtime[1].enabled, false);
  assert.equal(runtime[1].shortcut, previous.shortcut);
  assert.equal(runtime[2].presetId, settings.slots[2].presetId);
  settings.slots[1] = { ...settings.slots[1], presetId: previous.presetId, enabled: true };
  assert.deepEqual(normalizeQuickMessageSlots(settings.slots)[1], previous);
});

test("voice and music use complete items without pagination", () => {
  const source = readFileSync(
    new URL("../src/renderer/src/components/chat/QuickMessageRow.tsx", import.meta.url),
    "utf8",
  );
  for (const removed of ["ChevronRight", "setPage", "currentPage", "needsPages", "chat-quick-more"])
    assert.equal(source.includes(removed), false);
  assert.equal(source.includes("if (used + cost > budget) break;"), true);
});
