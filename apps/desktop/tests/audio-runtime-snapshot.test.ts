import assert from "node:assert/strict";
import test from "node:test";

import { createAudioRuntimeSnapshot } from "../src/renderer/src/features/audio/audioRuntimeSnapshot";
import { PHONE_MIC_DEVICE_ID } from "../src/renderer/src/features/audio/phoneMicSource";

test("audio runtime separates requested, applied and observed microphone state", () => {
  const settings = {
    isNoiseSuppressionEnabled: true,
    isVoiceEnhancementEnabled: true,
    isEchoCancellationEnabled: true,
    isAutoGainControlEnabled: true,
    preferredInputDeviceId: PHONE_MIC_DEVICE_ID,
    preferredOutputDeviceId: "usb-speaker",
  };
  const snapshot = createAudioRuntimeSnapshot({
    settings,
    appliedSourceId: PHONE_MIC_DEVICE_ID,
    processorPresent: true,
    processorDiagnostics: {
      noiseProcessor: "deepfilter_unavailable",
      voiceEnhancementProcessor: "dsp_active",
    },
    outputTrack: { readyState: "live" } as MediaStreamTrack,
    roomClientPresent: true,
    appliedOutputDeviceId: "default",
    outputRouteStatus: "fallback",
  });
  assert.equal(snapshot.desired.noiseSuppression, true);
  assert.equal(snapshot.desired.inputSource, "phone");
  assert.equal(snapshot.applied.noiseProcessor, "deepfilter_unavailable");
  assert.equal(snapshot.applied.inputSource, "phone");
  assert.equal(snapshot.desired.outputDevice, "selected");
  assert.equal(snapshot.applied.outputDevice, "default");
  assert.equal(snapshot.observed.outputRouteStatus, "fallback");
  assert.equal(snapshot.observed.outputTrackState, "live");
  assert.equal(snapshot.health, "degraded");
  assert.equal(
    createAudioRuntimeSnapshot({
      settings,
      processorPresent: true,
      outputTrack: { readyState: "ended" } as MediaStreamTrack,
      roomClientPresent: true,
    }).health,
    "failed",
  );
  assert.equal(
    createAudioRuntimeSnapshot({ processorPresent: false, roomClientPresent: false }).health,
    "idle",
  );
});
