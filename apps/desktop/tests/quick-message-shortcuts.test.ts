import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getQuickMessageShortcutSlots } from "@private-voice/shared";
import { defaultSettings } from "../src/main/settings-migration";

test("one master gates all 13 slots, preserving indexes, choices and individual switches", () => {
  const settings = {
    ...defaultSettings.quickMessages,
    slots: defaultSettings.quickMessages.slots.map((slot, index) => ({
      ...slot,
      enabled: index !== 2,
    })),
    musicSlots: defaultSettings.quickMessages.musicSlots.map((slot, index) => ({
      ...slot,
      enabled: index !== 1,
    })),
  };
  const saved = structuredClone(settings);
  const expected = [...settings.slots, ...settings.musicSlots];
  for (const shortcutsEnabled of [false, true, false, true]) {
    const effective = getQuickMessageShortcutSlots({ ...settings, shortcutsEnabled });
    assert.equal(effective.length, 13);
    effective.forEach((slot, index) => {
      assert.equal(slot.enabled, shortcutsEnabled && expected[index].enabled);
      assert.equal(slot.shortcut, expected[index].shortcut);
      assert.equal(slot.presetId, expected[index].presetId);
    });
  }
  assert.deepEqual(settings, saved);
});

test("legacy music opt-in cannot enable the new overall master", () => {
  const settings = { ...defaultSettings.quickMessages, musicShortcutsEnabled: true };
  delete settings.shortcutsEnabled;
  assert.equal(
    getQuickMessageShortcutSlots(settings).every((slot) => !slot.enabled),
    true,
  );
  assert.equal(
    getQuickMessageShortcutSlots({ ...settings, shortcutsEnabled: false }).every(
      (slot) => !slot.enabled,
    ),
    true,
  );
  assert.equal(
    getQuickMessageShortcutSlots({
      ...settings,
      musicShortcutsEnabled: false,
      shortcutsEnabled: true,
    }).some((slot, index) => index >= 8 && slot.enabled),
    true,
  );
});

test("production renderer drops late voice and music trigger events after the master closes", () => {
  const source = readFileSync(path.resolve("src/renderer/src/hooks/useRoomState.ts"), "utf8");
  const body = source.match(
    /quickMessageShortcutHandlerRef\.current = \(slotIndex\) => \{([\s\S]*?)\n {2}\};/,
  )?.[1];
  assert.ok(body);
  let settings = {
    ...defaultSettings,
    quickMessages: { ...defaultSettings.quickMessages, shortcutsEnabled: true },
  };
  const sent: string[] = [];
  const handler = new Function(
    "useSettingsStore",
    "getQuickMessageShortcutSlots",
    "sendConfiguredQuickMessage",
    "pushToast",
    `return (slotIndex) => {${body}};`,
  )(
    { getState: () => ({ settings }) },
    getQuickMessageShortcutSlots,
    async (presetId: string) => {
      sent.push(presetId);
    },
    () => assert.fail("closed shortcuts must not show a failed-send toast"),
  ) as (slot: number) => void;
  handler(0);
  handler(8);
  assert.deepEqual(sent, [
    settings.quickMessages.slots[0].presetId,
    settings.quickMessages.musicSlots[0].presetId,
  ]);
  settings = { ...settings, quickMessages: { ...settings.quickMessages, shortcutsEnabled: false } };
  handler(0);
  handler(8);
  handler(12);
  assert.equal(sent.length, 2);
  settings = { ...settings, quickMessages: { ...settings.quickMessages, shortcutsEnabled: true } };
  handler(0);
  handler(8);
  assert.equal(sent.length, 4);
});
