import assert from "node:assert/strict";
import test from "node:test";

import { defaultSettings } from "../src/main/settings-migration";
import {
  applyShortcutSettingsPatch,
  reconcileResetShortcuts,
} from "../src/main/settings-shortcut-reconciliation";

test("master releases all voice and music keyboard and mouse bindings without erasing slots", async () => {
  const active = new Map<number, string>();
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async () => true,
    configureQuickMessage: async (slot: number, key: string) => {
      active.delete(slot);
      if (key) active.set(slot, key);
      return Boolean(key);
    },
  };
  const previous = {
    ...defaultSettings,
    quickMessages: {
      ...defaultSettings.quickMessages,
      shortcutsEnabled: true,
      musicSlots: defaultSettings.quickMessages.musicSlots.map((slot, index) => ({
        ...slot,
        shortcut: index === 0 ? "Mouse4" : slot.shortcut,
        enabled: index !== 1,
      })),
    },
  };
  await reconcileResetShortcuts(defaultSettings, shortcuts);
  assert.equal(active.size, 0);
  await applyShortcutSettingsPatch(
    defaultSettings,
    previous,
    { quickMessages: previous.quickMessages },
    shortcuts,
  );
  assert.equal(active.get(8), "Mouse4");
  assert.equal(active.get(0), "Ctrl+Alt+1");
  assert.equal(active.has(9), false);
  assert.equal(active.get(10), "Ctrl+Shift+3");
  const off = {
    ...previous,
    quickMessages: { ...previous.quickMessages, shortcutsEnabled: false },
  };
  assert.deepEqual(
    await applyShortcutSettingsPatch(
      previous,
      off,
      { quickMessages: off.quickMessages },
      shortcuts,
    ),
    {},
  );
  assert.equal(active.size, 0);
  assert.deepEqual(off.quickMessages.slots, previous.quickMessages.slots);
  assert.deepEqual(off.quickMessages.musicSlots, previous.quickMessages.musicSlots);
  await applyShortcutSettingsPatch(
    off,
    previous,
    { quickMessages: previous.quickMessages },
    shortcuts,
  );
  assert.equal(active.get(8), "Mouse4");
  assert.equal(active.get(0), "Ctrl+Alt+1");
  assert.equal(active.has(9), false);
});

test("one failed music key does not turn the master back off or unregister working keys", async () => {
  const active = new Map<number, string>();
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async () => true,
    configureQuickMessage: async (slot: number, key: string) => {
      active.delete(slot);
      if (!key || slot === 8) return false;
      active.set(slot, key);
      return true;
    },
  };
  const current = {
    ...defaultSettings,
    quickMessages: { ...defaultSettings.quickMessages, shortcutsEnabled: true },
  };
  const rollback = await applyShortcutSettingsPatch(
    defaultSettings,
    current,
    { quickMessages: current.quickMessages },
    shortcuts,
  );
  assert.equal(rollback.quickMessages?.shortcutsEnabled, true);
  assert.deepEqual(rollback.quickMessages?.slots, defaultSettings.quickMessages.slots);
  assert.deepEqual(rollback.quickMessages?.musicSlots[0], {
    ...defaultSettings.quickMessages.musicSlots[0],
    enabled: false,
  });
  assert.deepEqual(
    rollback.quickMessages?.musicSlots.slice(1),
    defaultSettings.quickMessages.musicSlots.slice(1),
  );
  assert.equal(active.has(8), false);
  assert.equal(active.get(0), "Ctrl+Alt+1");
  assert.equal(active.get(9), "Ctrl+Shift+2");
  assert.equal(active.size, 12);
});

test("unavailable voice and music keys are isolated, retain their keys and can be retried", async () => {
  const active = new Map<number, string>();
  let blocked = new Set([1, 8]);
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async () => true,
    configureQuickMessage: async (slot: number, key: string) => {
      active.delete(slot);
      if (!key || blocked.has(slot)) return false;
      active.set(slot, key);
      return true;
    },
  };
  const requested = {
    ...defaultSettings,
    quickMessages: { ...defaultSettings.quickMessages, shortcutsEnabled: true, soundVolume: 0.4 },
  };
  const result = await applyShortcutSettingsPatch(
    defaultSettings,
    requested,
    { quickMessages: requested.quickMessages },
    shortcuts,
  );
  const confirmed = { ...requested, ...result };
  assert.equal(confirmed.quickMessages.shortcutsEnabled, true);
  assert.equal(confirmed.quickMessages.soundVolume, 0.4);
  assert.deepEqual(confirmed.quickMessages.slots[1], {
    ...requested.quickMessages.slots[1],
    enabled: false,
  });
  assert.deepEqual(confirmed.quickMessages.musicSlots[0], {
    ...requested.quickMessages.musicSlots[0],
    enabled: false,
  });
  assert.equal(active.has(1), false);
  assert.equal(active.has(8), false);
  assert.equal(active.get(2), "Ctrl+Alt+3");
  blocked = new Set();
  assert.deepEqual(
    await applyShortcutSettingsPatch(
      confirmed,
      requested,
      { quickMessages: requested.quickMessages },
      shortcuts,
    ),
    {},
  );
  assert.equal(active.get(1), "Ctrl+Alt+2");
  assert.equal(active.get(8), "Ctrl+Shift+1");
  const off = {
    ...requested,
    quickMessages: { ...requested.quickMessages, shortcutsEnabled: false },
  };
  assert.deepEqual(
    await applyShortcutSettingsPatch(
      requested,
      off,
      { quickMessages: off.quickMessages },
      shortcuts,
    ),
    {},
  );
  assert.equal(active.size, 0);
});

test("all keys unavailable still opens the editor with all failed slots off", async () => {
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async () => true,
    configureQuickMessage: async () => {
      throw new Error("unavailable");
    },
  };
  const requested = {
    ...defaultSettings,
    quickMessages: { ...defaultSettings.quickMessages, shortcutsEnabled: true },
  };
  const result = await applyShortcutSettingsPatch(
    defaultSettings,
    requested,
    { quickMessages: requested.quickMessages },
    shortcuts,
  );
  assert.equal(result.quickMessages?.shortcutsEnabled, true);
  assert.ok(result.quickMessages?.slots.every((slot) => !slot.enabled));
  assert.ok(result.quickMessages?.musicSlots.every((slot) => !slot.enabled));
  assert.deepEqual(
    result.quickMessages?.slots.map((slot) => slot.shortcut),
    requested.quickMessages.slots.map((slot) => slot.shortcut),
  );
  assert.deepEqual(
    result.quickMessages?.musicSlots.map((slot) => slot.shortcut),
    requested.quickMessages.musicSlots.map((slot) => slot.shortcut),
  );
});

test("failed Marker registration restores the persisted key", async () => {
  const markerKeys: string[] = [];
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async (key: string) => {
      markerKeys.push(key);
      return key !== "F9";
    },
    configurePushToTalk: async () => true,
    configureQuickMessage: async () => true,
  };
  const current = { ...defaultSettings, recordingMarkerShortcut: "F9" };
  const rollback = await applyShortcutSettingsPatch(
    defaultSettings,
    current,
    { recordingMarkerShortcut: "F9" },
    shortcuts,
  );
  assert.deepEqual(markerKeys, ["F9"]);
  assert.deepEqual(rollback, { recordingMarkerShortcut: "F8" });
});

test("failed PTT mouse binding restores the prior runtime binding and settings", async () => {
  const attempts: string[] = [];
  const previous = {
    ...defaultSettings,
    isPushToTalkEnabled: true,
    pushToTalkShortcut: "Mouse4",
  };
  const current = { ...previous, pushToTalkShortcut: "Mouse5" };
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async (key: string, enabled: boolean) => {
      attempts.push(`${key}:${enabled}`);
      return key !== "Mouse5";
    },
    configureQuickMessage: async () => true,
  };
  const rollback = await applyShortcutSettingsPatch(
    previous,
    current,
    { pushToTalkShortcut: "Mouse5" },
    shortcuts,
  );
  assert.deepEqual(attempts, ["Mouse5:true", "Mouse4:true"]);
  assert.deepEqual(rollback, {
    pushToTalkShortcut: "Mouse4",
    isPushToTalkEnabled: true,
  });
});

test("quick-message key swaps apply as one map without a temporary conflict", async () => {
  const previous = {
    ...defaultSettings,
    quickMessages: { ...defaultSettings.quickMessages, shortcutsEnabled: true },
  };
  const active = new Map<number, string>();
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async () => true,
    configureQuickMessage: async (slot: number, key: string) => {
      active.delete(slot);
      if (!key) return false;
      if ([...active.values()].includes(key)) return false;
      active.set(slot, key);
      return true;
    },
  };
  active.set(1, "Ctrl+Alt+2");
  active.set(2, "Ctrl+Alt+3");
  const slots = defaultSettings.quickMessages.slots.map((slot, index) => ({
    ...slot,
    shortcut: index === 1 ? "Ctrl+Alt+3" : index === 2 ? "Ctrl+Alt+2" : slot.shortcut,
  }));
  const current = {
    ...defaultSettings,
    quickMessages: { ...previous.quickMessages, slots },
  };
  const rollback = await applyShortcutSettingsPatch(
    previous,
    current,
    { quickMessages: current.quickMessages },
    shortcuts,
  );
  assert.deepEqual(rollback, {});
  assert.equal(active.get(1), "Ctrl+Alt+3");
  assert.equal(active.get(2), "Ctrl+Alt+2");
});

test("failed quick-message map restores previous bindings but preserves volume", async () => {
  const previous = {
    ...defaultSettings,
    quickMessages: { ...defaultSettings.quickMessages, shortcutsEnabled: true },
  };
  const active = new Map<number, string>();
  const shortcuts = {
    configureGlobalMute: async () => true,
    configureRecordingMarker: async () => true,
    configurePushToTalk: async () => true,
    configureQuickMessage: async (slot: number, key: string) => {
      active.delete(slot);
      if (!key) return false;
      if (key === "occupied" || [...active.values()].includes(key)) return false;
      active.set(slot, key);
      return true;
    },
  };
  active.set(1, "Ctrl+Alt+2");
  const slots = defaultSettings.quickMessages.slots.map((slot, index) =>
    index === 1 ? { ...slot, shortcut: "occupied" } : slot,
  );
  const current = {
    ...defaultSettings,
    quickMessages: { ...previous.quickMessages, slots, soundVolume: 0.4 },
  };
  const rollback = await applyShortcutSettingsPatch(
    previous,
    current,
    { quickMessages: current.quickMessages },
    shortcuts,
  );
  assert.equal(active.get(1), "Ctrl+Alt+2");
  assert.equal(rollback.quickMessages?.slots[1]?.shortcut, "Ctrl+Alt+2");
  assert.equal(rollback.quickMessages?.soundVolume, 0.4);
});

test("reset releases old owners before registering the default marker", async () => {
  const registered = new Map<string, string>([
    ["F8", "quick-message:0"],
    ["F10", "recording-marker"],
  ]);
  const apply = async (owner: string, accelerator: string): Promise<boolean> => {
    for (const [key, registeredOwner] of registered) {
      if (registeredOwner === owner) registered.delete(key);
    }
    if (!accelerator) return false;
    if (registered.has(accelerator)) return false;
    registered.set(accelerator, owner);
    return true;
  };
  const shortcuts = {
    configureGlobalMute: (key: string) => apply("mute", key),
    configureRecordingMarker: (key: string) => apply("recording-marker", key),
    configurePushToTalk: (key: string, enabled: boolean) =>
      apply("push-to-talk", enabled ? key : ""),
    configureQuickMessage: (slot: number, key: string) => apply(`quick-message:${slot}`, key),
  };
  const failed = await reconcileResetShortcuts(defaultSettings, shortcuts);
  assert.deepEqual(failed, []);
  assert.equal(registered.get("F8"), "recording-marker");
  assert.equal(registered.has("F10"), false);
  assert.equal(registered.has("Ctrl+Alt+1"), false);
});

test("unavailable default marker reports failure without leaving an old key active", async () => {
  const active = new Map<string, string>([["recording-marker", "F10"]]);
  const shortcuts = {
    configureGlobalMute: async () => false,
    configureRecordingMarker: async (key: string) => {
      active.delete("recording-marker");
      if (key === "F8") return false;
      if (key) active.set("recording-marker", key);
      return Boolean(key);
    },
    configurePushToTalk: async () => true,
    configureQuickMessage: async (_slot: number, key: string) => Boolean(key),
  };
  const failed = await reconcileResetShortcuts(defaultSettings, shortcuts);
  assert.deepEqual(failed, ["recording-marker"]);
  assert.equal(active.has("recording-marker"), false);
});
