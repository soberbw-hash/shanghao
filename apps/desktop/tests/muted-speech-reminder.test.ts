import assert from "node:assert/strict";
import test from "node:test";
import { createMutedSpeechReminder } from "../src/renderer/src/features/audio/mutedSpeechReminder";
import { migrateSettings } from "../src/main/settings-migration";

const sample = (now: number, patch = {}) => ({
  now,
  scopeId: "room-a:mic-a",
  eligible: true,
  voiceActivity: "active" as const,
  speechProbability: 0.9,
  processingMode: "near_speech" as const,
  remoteEchoDetected: false,
  ...patch,
});

test("sustained local voice takes 1.5 seconds and reminders are globally limited to once per minute", () => {
  const gate = createMutedSpeechReminder();
  for (let now = 0; now < 1500; now += 250) assert.equal(gate.observe(sample(now)), false);
  assert.equal(gate.observe(sample(1500)), true);
  for (let now = 1750; now < 61500; now += 250) assert.equal(gate.observe(sample(now)), false);
  assert.equal(gate.observe(sample(61500)), true);
});

test("noise, echo, unavailable classification and stale observations cannot accumulate speech", () => {
  for (const patch of [
    { speechProbability: 0.5 },
    { voiceActivity: "inactive" },
    { processingMode: "echo" },
    { remoteEchoDetected: true },
    { processingMode: undefined },
    { speechProbability: NaN },
    { eligible: false },
  ]) {
    const gate = createMutedSpeechReminder();
    for (let now = 0; now <= 5000; now += 250)
      assert.equal(gate.observe(sample(now, patch)), false);
  }
  const gate = createMutedSpeechReminder();
  gate.observe(sample(0));
  assert.equal(gate.observe(sample(5000)), false, "a suspended UI is not five seconds of speech");
  for (let now = 5250; now <= 6250; now += 250) assert.equal(gate.observe(sample(now)), false);
  assert.equal(gate.observe(sample(6500)), true);
});

test("silence and room/device changes restart continuity, but reset and re-muting do not reset cooldown", () => {
  const gate = createMutedSpeechReminder();
  for (let now = 0; now <= 1000; now += 250) gate.observe(sample(now));
  assert.equal(gate.observe(sample(1250, { voiceActivity: "inactive" })), false);
  for (let now = 1500; now <= 2500; now += 250) assert.equal(gate.observe(sample(now)), false);
  assert.equal(gate.observe(sample(2750, { scopeId: "room-b:mic-b" })), false);
  for (let now = 3000; now < 4250; now += 250)
    assert.equal(gate.observe(sample(now, { scopeId: "room-b:mic-b" })), false);
  assert.equal(gate.observe(sample(4250, { scopeId: "room-b:mic-b" })), true);
  gate.reset();
  for (let now = 4500; now <= 10000; now += 250) assert.equal(gate.observe(sample(now)), false);
});

test("manual microphone toggles are distinguished from automatic, phone, and deafen muting", async () => {
  const previousWindow = Reflect.get(globalThis, "window");
  Object.assign(globalThis, {
    window: { desktopApi: { app: { writeLog: async () => undefined } } },
  });
  const { useAudioStore } = await import("../src/renderer/src/store/audioStore");
  try {
    const store = useAudioStore;
    store.getState().setPhoneMode(false);
    store.getState().setAudioState({ isMuted: false, isDeafened: false });
    store.getState().toggleMicrophone();
    assert.equal(store.getState().isManuallyMuted, true);
    store.getState().setPhoneMode(true);
    assert.equal(store.getState().isManuallyMuted, false);
    store.getState().setPhoneMode(false);
    assert.equal(store.getState().isManuallyMuted, true, "restore the pre-phone manual choice");
    store.getState().setMuted(true);
    assert.equal(
      store.getState().isManuallyMuted,
      false,
      "automatic away/input safety mute is excluded",
    );
    store.getState().setMuted(false);
    store.getState().toggleDeafen();
    assert.equal(store.getState().isManuallyMuted, false);
    store.getState().toggleMicrophone();
    assert.equal(
      store.getState().isManuallyMuted,
      false,
      "blocked mic toggle must not claim manual mute",
    );
    store.getState().setAudioState({ isMuted: false, isDeafened: false });
  } finally {
    if (previousWindow === undefined) Reflect.deleteProperty(globalThis, "window");
    else Object.assign(globalThis, { window: previousWindow });
  }
});

test("reminders default on for older settings and an explicit saved off preference survives", () => {
  assert.equal(migrateSettings({}).settings.isMutedSpeechReminderEnabled, true);
  assert.equal(
    migrateSettings({ isMutedSpeechReminderEnabled: false }).settings.isMutedSpeechReminderEnabled,
    false,
  );
  assert.equal(
    migrateSettings({ isMutedSpeechReminderEnabled: "false" } as never).settings
      .isMutedSpeechReminderEnabled,
    true,
  );
});
