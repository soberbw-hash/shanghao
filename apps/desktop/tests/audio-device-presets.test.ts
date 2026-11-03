import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAudioDevicePresets,
  selectAudioDeviceSettings,
  type AppSettings,
  type AudioDevicePreset,
} from "@private-voice/shared";
import { defaultSettings, migrateSettings } from "../src/main/settings-migration";
import { applyAudioDevicePreset } from "../src/renderer/src/features/audio/audioPresetTransaction";
import {
  holdAudioSend,
  linkAudioSendGate,
  setAudioSendEnabled,
} from "../src/renderer/src/features/audio/audioSendGate";
const preset = (): AudioDevicePreset => ({
  slot: 1,
  name: "游戏耳机",
  audio: {
    ...selectAudioDeviceSettings(defaultSettings),
    preferredInputDeviceId: "headset-mic",
    preferredOutputDeviceId: "headset-speaker",
    microphoneSendVolume: 1.2,
    speakerMasterVolume: 0.7,
  },
  microphoneMuted: false,
  speakerMuted: false,
});
test("profiles migrate with allowlisted settings, bounded slots, values and independent arrays", () => {
  const value = preset();
  assert.deepEqual(
    migrateSettings({ ...defaultSettings, audioDevicePresets: [value] }).settings
      .audioDevicePresets,
    [value],
  );
  const unknown = { ...value, executable: "unsafe" };
  assert.equal("executable" in normalizeAudioDevicePresets([unknown])[0]!, false);
  assert.equal(normalizeAudioDevicePresets([value, value]).length, 1);
  assert.deepEqual(
    normalizeAudioDevicePresets([
      { ...value, audio: { ...value.audio, speakerMasterVolume: NaN } },
    ]),
    [],
  );
  assert.deepEqual(normalizeAudioDevicePresets([{ ...value, name: "x\u0000" }]), []);
  const copy = normalizeAudioDevicePresets([value])[0]!;
  copy.audio.micEqualizerGains[0] = 8;
  assert.equal(value.audio.micEqualizerGains[0], 0);
});
function harness() {
  let settings = structuredClone(defaultSettings),
    owns = true,
    held = false,
    released = 0;
  const calls: string[] = [],
    gates: boolean[] = [];
  return {
    calls,
    gates,
    change: (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch };
    },
    leave: () => {
      owns = false;
    },
    getSettings: () => settings,
    ownsRoom: () => owns,
    validateDevices: () => undefined,
    hold: () => {
      held = true;
      calls.push("hold");
      return () => {
        if (held) {
          held = false;
          released++;
          calls.push("release");
        }
      };
    },
    save: async (patch: Partial<AppSettings>) => {
      calls.push("save");
      settings = { ...settings, ...patch };
    },
    output: async (id?: string) => {
      assert.equal(held, true);
      calls.push("output:" + id);
    },
    input: async (id?: string) => {
      assert.equal(held, true);
      calls.push("input:" + id);
      return true;
    },
    commit: () => {
      assert.equal(held, true);
      calls.push("commit");
    },
    restoreGate: (safe: boolean) => {
      assert.equal(held, false);
      gates.push(safe);
    },
    releaseCount: () => released,
  };
}
test("both routes verify before commit; the send gate stays closed until completion", async () => {
  const state = harness();
  await applyAudioDevicePreset(preset(), state);
  assert.deepEqual(state.calls, [
    "hold",
    "save",
    "output:headset-speaker",
    "input:headset-mic",
    "commit",
    "release",
  ]);
  assert.deepEqual(state.gates, [true]);
  assert.equal(state.releaseCount(), 1);
});
test("missing devices fail without saving or touching the current call", async () => {
  const state = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), {
      ...state,
      validateDevices: () => {
        throw Error("missing_device");
      },
    }),
    /missing_device/,
  );
  assert.deepEqual(state.calls, []);
});

test("output failure restores the old route without ever selecting the new microphone", async () => {
  const state = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), {
      ...state,
      output: async (id) => {
        state.calls.push("output:" + id);
        if (id) throw Error("unavailable_output");
      },
    }),
    /unavailable_output/,
  );
  assert.ok(!state.calls.includes("input:headset-mic"));
  assert.ok(state.calls.includes("input:undefined"));
  assert.equal(state.getSettings().preferredOutputDeviceId, undefined);
  assert.deepEqual(state.gates, [true]);
});
test("input failure restores settings and both routes; failed rollback must remain muted", async () => {
  const state = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), {
      ...state,
      input: async (id) => {
        state.calls.push("input:" + id);
        return id !== "headset-mic";
      },
    }),
    /input_failed/,
  );
  assert.deepEqual(state.gates, [true]);
  assert.equal(state.getSettings().preferredInputDeviceId, undefined);
  assert.ok(state.calls.includes("output:undefined"));
  const failed = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), { ...failed, input: async () => false }),
    /input_failed/,
  );
  assert.deepEqual(failed.gates, [false]);
  assert.equal(failed.releaseCount(), 1);
});
test("late work cannot commit into a departed room or overwrite a newer setting", async () => {
  const state = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), {
      ...state,
      output: async () => {
        state.change({ preferredInputDeviceId: "new-user-choice" });
        state.leave();
      },
    }),
    /room_changed/,
  );
  assert.equal(state.getSettings().preferredInputDeviceId, "new-user-choice");
  assert.ok(!state.calls.includes("commit"));
  assert.deepEqual(state.gates, [false]);
  const edited = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), {
      ...edited,
      output: async () => {
        edited.change({ speakerMasterVolume: 1.8 });
      },
    }),
    /superseded/,
  );
  assert.equal(edited.getSettings().speakerMasterVolume, 1.8);
  assert.deepEqual(edited.gates, [false]);
});
test("send holds cover old, replacement and mixed tracks; releasing never opens the microphone", () => {
  const old = { enabled: true } as MediaStreamTrack,
    replacement = { enabled: false } as MediaStreamTrack;
  const mixed = { enabled: true } as MediaStreamTrack,
    unlink = linkAudioSendGate(old, mixed);
  const first = holdAudioSend(old),
    second = holdAudioSend();
  setAudioSendEnabled(old, true);
  setAudioSendEnabled(replacement, true);
  assert.equal(old.enabled, false);
  assert.equal(mixed.enabled, false);
  assert.equal(replacement.enabled, false);
  first();
  first();
  setAudioSendEnabled(replacement, true);
  assert.equal(replacement.enabled, false);
  second();
  assert.equal(replacement.enabled, false);
  setAudioSendEnabled(replacement, true);
  assert.equal(replacement.enabled, true);
  unlink();
});

test("a canceled controller cannot roll back a later room's settings or routes", async () => {
  const state = harness();
  await assert.rejects(
    applyAudioDevicePreset(preset(), {
      ...state,
      ownsSettings: () => false,
      output: async () => {
        state.leave();
        state.change({ preferredInputDeviceId: "new-room" });
      },
    }),
    /room_changed/,
  );
  assert.equal(state.getSettings().preferredInputDeviceId, "new-room");
  assert.equal(state.calls.filter((call) => call === "save").length, 1);
  assert.equal(
    state.calls.some((call) => call.startsWith("input:")),
    false,
  );
});
