import assert from "node:assert/strict";
import test from "node:test";

import type { PeerHealthDiagnostics } from "@private-voice/shared";

import type { AudioRuntimeSnapshot } from "../src/renderer/src/features/audio/audioRuntimeSnapshot";
import type { RemoteAudioMixerDiagnostics } from "../src/renderer/src/features/audio/RemoteAudioMixer";
import {
  aggregateHealthLevel,
  microphoneHealth,
  roomAudioHealth,
  screenShareHealth,
  speakerHealth,
} from "../src/renderer/src/features/diagnostics/healthProjection";

test("overall health does not call unobserved runtime paths healthy", () => {
  assert.equal(aggregateHealthLevel([]), "未检测");
  assert.equal(aggregateHealthLevel(["正常", "未检测"]), "未检测");
  assert.equal(aggregateHealthLevel(["正常", "需要看看", "未检测"]), "需要看看");
  assert.equal(aggregateHealthLevel(["有问题", "未检测"]), "有问题");
  assert.equal(aggregateHealthLevel(["正常", "正常"]), "正常");
});

const liveInput = (): AudioRuntimeSnapshot => ({
  desired: {
    noiseSuppression: true,
    voiceEnhancement: true,
    echoCancellation: true,
    autoGainControl: true,
    inputSource: "device",
    outputDevice: "selected",
  },
  applied: { noiseProcessor: "deepfilter", voiceEnhancementProcessor: "dsp" },
  observed: {
    processorPresent: true,
    outputTrackState: "live",
    outputRouteStatus: "fallback",
  },
  health: "degraded",
});

test("screen share health does not treat an idle diagnostics object as a working stream", () => {
  const idle = {
    send: {},
    receive: {},
    present: {},
    fallback: { active: false, targetCount: 0, activeForMs: 0, overdue: false },
    updatedAt: Date.now(),
  };
  assert.equal(screenShareHealth(idle).level, "未检测");
  assert.equal(screenShareHealth({ ...idle, capture: { width: 1920 } }).level, "正常");
  assert.equal(
    screenShareHealth({ ...idle, fallback: { ...idle.fallback, overdue: true } }).level,
    "需要看看",
  );
});

test("health overview does not claim that detected hardware proves audible voice", () => {
  assert.equal(microphoneHealth().level, "未检测");
  assert.equal(
    speakerHealth({ outputDeviceCount: 1, roomActive: false, remotePeerCount: 0 }).level,
    "未检测",
  );
  assert.equal(roomAudioHealth({ remotePeerCount: 1, webrtcReadyPeerCount: 1 }).level, "未检测");
});

test("microphone health follows its own track and DSP rather than output fallback", () => {
  const audio = liveInput();
  assert.equal(microphoneHealth(audio).level, "正常");
  audio.applied.noiseProcessor = "deepfilter_unavailable";
  assert.equal(microphoneHealth(audio).level, "需要看看");
  audio.observed.outputTrackState = "ended";
  assert.equal(microphoneHealth(audio).level, "有问题");
});

test("speaker and room health distinguish observed playback path from stalled peers", () => {
  const mixer = {
    contextState: "running",
    outputRouteStatus: "applied",
  } as RemoteAudioMixerDiagnostics;
  assert.equal(
    speakerHealth({ outputDeviceCount: 1, roomActive: true, remotePeerCount: 1, mixer }).level,
    "正常",
  );
  mixer.outputRouteStatus = "fallback";
  assert.equal(
    speakerHealth({ outputDeviceCount: 1, roomActive: true, remotePeerCount: 1, mixer }).level,
    "需要看看",
  );
  const peer = { level: "critical", audioFlow: "stalled" } as PeerHealthDiagnostics;
  assert.equal(
    roomAudioHealth({ remotePeerCount: 1, webrtcReadyPeerCount: 1, peerHealth: { friend: peer } })
      .level,
    "有问题",
  );
});

test("room audio health requires flow evidence and treats a muted friend as unobserved", () => {
  const peer = {
    level: "healthy",
    audioFlow: "muted",
  } as PeerHealthDiagnostics;
  const input = { remotePeerCount: 1, webrtcReadyPeerCount: 1, peerHealth: { friend: peer } };
  assert.equal(roomAudioHealth(input).level, "未检测");
  peer.audioFlow = undefined;
  assert.equal(roomAudioHealth(input).level, "未检测");
  peer.audioFlow = "flowing";
  assert.equal(roomAudioHealth(input).level, "正常");
});
