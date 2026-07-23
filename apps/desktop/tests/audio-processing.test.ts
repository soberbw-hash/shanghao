import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FOURTH_ORDER_BUTTERWORTH_Q,
  fourthOrderHighPassMagnitude,
} from "../src/renderer/src/features/audio/filterMath";
import { hasPlayableAudioTrack } from "../src/renderer/src/features/audio/remoteAudioTrack";

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
  assert.equal(worklet.includes("denoiseState.processFrame(frame)"), true);
  assert.equal(worklet.includes("vadProbability"), true);
  assert.equal(worklet.includes("noiseFloorRms"), true);
  assert.equal(worklet.includes("isKeyboardLikeTransient"), true);
  assert.equal(worklet.includes("applyResidualNoiseGateAndLimiter"), true);
  assert.equal(worklet.includes("output.fill(0)"), true);
  assert.equal(
    existsSync(path.join(root, "apps/desktop/node_modules/@shiguredo/rnnoise-wasm/LICENSE")),
    true,
  );
});

test("remote audio uses one shared mixer without reusing audio elements", () => {
  const renderer = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/RemoteAudioRenderer.tsx"),
    "utf8",
  );
  const mixer = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/RemoteAudioMixer.ts"),
    "utf8",
  );
  const home = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/pages/HomePage.tsx"),
    "utf8",
  );
  const main = readFileSync(path.join(root, "apps/desktop/src/main/index.ts"), "utf8");
  const relay = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/room/signalingAudioRelay.ts"),
    "utf8",
  );

  assert.equal(renderer.includes("getRemoteAudioMixer()"), true);
  assert.equal(renderer.includes("HTMLAudioElement"), false);
  assert.equal(renderer.includes('mixer.unlock("window-user-activation")'), true);
  assert.equal(mixer.includes("new AudioContext"), true);
  assert.equal(mixer.includes("createMediaStreamSource(input.stream)"), true);
  assert.equal(mixer.includes("createDynamicsCompressor"), true);
  assert.equal(mixer.includes("channels = new Map"), true);
  assert.equal(mixer.includes("relayChannels = new Map"), true);
  assert.equal(mixer.includes("playRelaySamples"), true);
  assert.equal(mixer.includes("getRemoteAudioMixer"), true);
  assert.equal(mixer.includes(".suspend()"), false);
  assert.equal(mixer.includes('this.outputDeviceId || "default"'), true);
  assert.equal(home.includes('unlock("enter-channel")'), true);
  assert.equal(relay.includes("getRemoteAudioMixer"), true);
  assert.equal(relay.includes('unlock("signaling-audio-relay")'), true);
  assert.equal(relay.includes("new FallbackAudioPlayer(message.peerId)"), true);
  assert.equal(main.includes('appendSwitch("autoplay-policy", "no-user-gesture-required")'), true);
});

test("late-join remote audio stays attached while Chromium temporarily mutes the live track", () => {
  const stream = {
    getAudioTracks: () => [{ readyState: "live", enabled: true, muted: true }],
  } as unknown as MediaStream;

  assert.equal(hasPlayableAudioTrack(stream), true);
});

test("ended or disabled remote audio tracks are not attached to the shared mixer", () => {
  const ended = {
    getAudioTracks: () => [{ readyState: "ended", enabled: true, muted: false }],
  } as unknown as MediaStream;
  const disabled = {
    getAudioTracks: () => [{ readyState: "live", enabled: false, muted: false }],
  } as unknown as MediaStream;

  assert.equal(hasPlayableAudioTrack(ended), false);
  assert.equal(hasPlayableAudioTrack(disabled), false);
});
