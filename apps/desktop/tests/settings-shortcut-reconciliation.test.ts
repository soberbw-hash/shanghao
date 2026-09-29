import assert from "node:assert/strict";
import test from "node:test";

import { defaultSettings } from "../src/main/settings-migration";
import {
  applyShortcutSettingsPatch,
  reconcileResetShortcuts,
} from "../src/main/settings-shortcut-reconciliation";

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
    quickMessages: { ...defaultSettings.quickMessages, slots },
  };
  const rollback = await applyShortcutSettingsPatch(
    defaultSettings,
    current,
    { quickMessages: current.quickMessages },
    shortcuts,
  );
  assert.deepEqual(rollback, {});
  assert.equal(active.get(1), "Ctrl+Alt+3");
  assert.equal(active.get(2), "Ctrl+Alt+2");
});

test("failed quick-message map restores previous bindings but preserves volume", async () => {
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
    quickMessages: { ...defaultSettings.quickMessages, slots, soundVolume: 0.4 },
  };
  const rollback = await applyShortcutSettingsPatch(
    defaultSettings,
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
  assert.equal([...registered.values()].filter((value) => value === "quick-message:0").length, 0);
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
