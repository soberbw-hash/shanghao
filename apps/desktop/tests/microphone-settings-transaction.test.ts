import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../src/main/settings-migration";
import {
  applyMicrophoneProcessingPatch,
  type MicrophoneProcessingPatch,
} from "../src/renderer/src/features/audio/microphoneSettingsTransaction";

const harness = () => {
  let settings = structuredClone(defaultSettings);
  const writes: MicrophoneProcessingPatch[] = [];
  return {
    getSettings: () => settings,
    saveSettings: async (patch: MicrophoneProcessingPatch) => {
      writes.push({ ...patch });
      settings = { ...settings, ...patch };
    },
    change: (patch: Partial<typeof settings>) => {
      settings = { ...settings, ...patch };
    },
    writes,
  };
};

test("failed microphone graph switch restores only the requested setting", async () => {
  const state = harness();
  const old = state.getSettings().isNoiseSuppressionEnabled;
  const applied = await applyMicrophoneProcessingPatch(
    { isNoiseSuppressionEnabled: !old },
    {
      ...state,
      apply: async () => {
        assert.equal(state.getSettings().isNoiseSuppressionEnabled, !old);
        state.change({ soundVolume: 0.25 });
        return false;
      },
    },
  );
  assert.equal(applied, false);
  assert.equal(state.getSettings().isNoiseSuppressionEnabled, old);
  assert.equal(state.getSettings().soundVolume, 0.25);
  assert.equal(state.writes.length, 2);
});

test("successful graph switch retains the saved processing controls", async () => {
  const state = harness();
  const patch = { isEchoCancellationEnabled: false, isVoiceEnhancementEnabled: false };
  assert.equal(
    await applyMicrophoneProcessingPatch(patch, { ...state, apply: async () => true }),
    true,
  );
  assert.equal(state.getSettings().isEchoCancellationEnabled, false);
  assert.equal(state.getSettings().isVoiceEnhancementEnabled, false);
  assert.deepEqual(state.writes, [patch]);
});

test("thrown graph failure restores controls before surfacing the original error", async () => {
  const state = harness();
  const error = new Error("device unavailable");
  const old = state.getSettings().isAutoGainControlEnabled;
  await assert.rejects(
    applyMicrophoneProcessingPatch(
      { isAutoGainControlEnabled: !old },
      {
        ...state,
        apply: async () => {
          throw error;
        },
      },
    ),
    (caught) => caught === error,
  );
  assert.equal(state.getSettings().isAutoGainControlEnabled, old);
});

test("failure cannot overwrite a later processing setting change", async () => {
  const state = harness();
  const old = state.getSettings().isNoiseSuppressionEnabled;
  await applyMicrophoneProcessingPatch(
    { isNoiseSuppressionEnabled: !old },
    {
      ...state,
      apply: async () => {
        state.change({ isNoiseSuppressionEnabled: old });
        return false;
      },
    },
  );
  assert.equal(state.writes.length, 1);
  assert.equal(state.getSettings().isNoiseSuppressionEnabled, old);
});

test("saving failure never switches the microphone graph", async () => {
  const state = harness();
  let calls = 0;
  await assert.rejects(
    applyMicrophoneProcessingPatch(
      { isAutoGainControlEnabled: false },
      {
        ...state,
        saveSettings: async () => {
          throw new Error("save failed");
        },
        apply: async () => {
          calls++;
          return true;
        },
      },
    ),
    /save failed/,
  );
  assert.equal(calls, 0);
});

test("missing settings never saves or switches the microphone graph", async () => {
  const result = await applyMicrophoneProcessingPatch(
    { isAutoGainControlEnabled: false },
    {
      getSettings: () => undefined,
      saveSettings: async () => {
        assert.fail("must not save");
      },
      apply: async () => {
        assert.fail("must not apply");
      },
    },
  );
  assert.equal(result, false);
});

test("rollback saving failure is visible to the caller", async () => {
  const state = harness();
  let saves = 0;
  await assert.rejects(
    applyMicrophoneProcessingPatch(
      { isAutoGainControlEnabled: false },
      {
        ...state,
        saveSettings: async (patch) => {
          if (++saves === 2) throw new Error("rollback failed");
          await state.saveSettings(patch);
        },
        apply: async () => false,
      },
    ),
    /rollback failed/,
  );
});
