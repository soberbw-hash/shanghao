import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { applyMicrophoneProcessingPatch } from "../src/renderer/src/features/audio/microphoneSettingsTransaction";
import { defaultSettings } from "../src/main/settings-migration";

const source = ts.transpileModule(
  readFileSync(
    new URL("../src/renderer/src/features/audio/useMicrophoneProcessingUpdate.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } },
).outputText;
const harness = (apply: () => Promise<boolean>) => {
  let settings = structuredClone(defaultSettings);
  const store = Object.assign(
    (select: (state: object) => unknown) =>
      select({
        saveSettings: async (patch: object) => {
          settings = { ...settings, ...patch };
        },
      }),
    { getState: () => ({ settings }) },
  );
  const module = {
    exports: {} as {
      useMicrophoneProcessingUpdate: (apply: () => Promise<boolean>) => {
        isProcessingBusy: () => boolean;
        applyProcessingPatch: (patch: object) => Promise<boolean>;
      };
    },
  };
  runInNewContext(source, {
    exports: module.exports,
    require: (id: string) => {
      if (id === "react") return { useRef: (current: boolean) => ({ current }) };
      if (id === "../../store/settingsStore") return { useSettingsStore: store };
      if (id === "./microphoneSettingsTransaction") return { applyMicrophoneProcessingPatch };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return { ...module.exports.useMicrophoneProcessingUpdate(apply), getSettings: () => settings };
};

test("microphone controls share a lock until the active processing change finishes", async () => {
  let finish!: (value: boolean) => void;
  let calls = 0;
  const state = harness(() => {
    calls += 1;
    return new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  });
  const pending = state.applyProcessingPatch({ isNoiseSuppressionEnabled: false });
  assert.equal(state.isProcessingBusy(), true);
  assert.equal(await state.applyProcessingPatch({ isAutoGainControlEnabled: false }), false);
  assert.equal(calls, 1);
  finish(true);
  assert.equal(await pending, true);
  assert.equal(state.isProcessingBusy(), false);
});

test("failed processing updates roll back and release the control lock for a retry", async () => {
  const state = harness(async () => {
    throw new Error("capture failed");
  });
  const previous = state.getSettings().isNoiseSuppressionEnabled;
  await assert.rejects(
    state.applyProcessingPatch({ isNoiseSuppressionEnabled: !previous }),
    /capture failed/,
  );
  assert.equal(state.getSettings().isNoiseSuppressionEnabled, previous);
  assert.equal(state.isProcessingBusy(), false);
  await assert.rejects(
    state.applyProcessingPatch({ isNoiseSuppressionEnabled: !previous }),
    /capture failed/,
  );
  assert.equal(state.isProcessingBusy(), false);
});
