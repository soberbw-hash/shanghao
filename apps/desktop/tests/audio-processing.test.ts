import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FOURTH_ORDER_BUTTERWORTH_Q,
  fourthOrderHighPassMagnitude,
} from "../src/renderer/src/features/audio/filterMath";

const root = path.resolve(process.cwd(), "../..");

test("fourth-order low cut suppresses rumble without removing speech", () => {
  assert.deepEqual(
    FOURTH_ORDER_BUTTERWORTH_Q.map((value) => Number(value.toFixed(3))),
    [0.541, 1.307],
  );
  assert.ok(fourthOrderHighPassMagnitude(30, 90) < 0.02);
  assert.ok(fourthOrderHighPassMagnitude(90, 90) > 0.7);
  assert.ok(fourthOrderHighPassMagnitude(1_000, 90) > 0.999);
});

test("RNNoise runs in an AudioWorklet and has an explicit browser fallback", () => {
  const processor = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/microphoneProcessor.ts"),
    "utf8",
  );
  const worklet = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/rnnoiseProcessor.worklet.ts"),
    "utf8",
  );
  assert.equal(processor.includes("new AudioWorkletNode"), true);
  assert.equal(processor.includes("enableBrowserNoiseSuppression"), true);
  assert.equal(processor.includes('diagnostics.noiseProcessor = "browser_fallback"'), true);
  assert.equal(processor.includes("audio-processor-fallback"), true);
  assert.equal(worklet.includes("import { Rnnoise"), true);
  assert.equal(worklet.includes('registerProcessor("shanghao-rnnoise"'), true);
  assert.equal(worklet.includes("PCM_SCALE"), true);
  assert.equal(worklet.includes('type: "overloaded"'), true);
  assert.equal(worklet.includes("output.set(input)"), true);
  assert.equal(
    existsSync(path.join(root, "apps/desktop/node_modules/@shiguredo/rnnoise-wasm/LICENSE")),
    true,
  );
});

test("remote audio attaches directly to MediaStream without reusing an audio element", () => {
  const renderer = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/RemoteAudioRenderer.tsx"),
    "utf8",
  );

  assert.equal(renderer.includes("createMediaElementSource"), false);
  assert.equal(renderer.includes("createMediaStreamSource(stream)"), true);
  assert.equal(renderer.includes("Failed to attach remote audio stream"), true);
});
