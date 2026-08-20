import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  FOURTH_ORDER_BUTTERWORTH_Q,
  fourthOrderHighPassMagnitude,
} from "../src/renderer/src/features/audio/filterMath";
import {
  clampMemberVolume,
  memberVolumeToPercent,
  toggleLocalMemberMute,
} from "../src/renderer/src/features/audio/memberVolume";
import {
  advanceLoudnessBalance,
  applyLoudnessBalanceToMemberVolume,
  createLoudnessBalanceState,
  FRIEND_LOUDNESS_TARGET_LUFS,
  FRIEND_LOUDNESS_HANGOVER_MS,
} from "../src/renderer/src/features/audio/loudnessBalance";
import { hasPlayableAudioTrack } from "../src/renderer/src/features/audio/remoteAudioTrack";
import { resolveRemoteAudioPath } from "../src/renderer/src/features/audio/remoteAudioPathSelection";
import {
  DEEPFILTER_BASE_SUPPRESSION_LEVEL,
  DEEPFILTER_SPEECH_SUPPRESSION_LEVEL,
  SPEECH_PROCESSED_MIX,
  SPEECH_RAW_MIX,
} from "../src/renderer/src/features/audio/microphoneProcessor";
import {
  advanceSpeechProtection,
  approachSuppressionLevel,
  createSpeechProtectionState,
  SPEECH_PROTECTION_HANGOVER_MS,
} from "../src/renderer/src/features/audio/speechProtection";
import {
  advanceSpeakingActivity,
  createSpeakingActivityState,
} from "../../../packages/webrtc/src/speaking";

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

test("speaking activity learns steady background noise and still opens for real voice", () => {
  let state = createSpeakingActivityState();
  for (let now = 0; now <= 12_000; now += 16) {
    state = advanceSpeakingActivity(state, 0.035, now);
  }
  assert.equal(state.isSpeaking, false);

  state = advanceSpeakingActivity(state, 0.12, 12_016);
  assert.equal(state.isSpeaking, true);
  state = advanceSpeakingActivity(state, 0, 12_250);
  assert.equal(state.isSpeaking, false);
});

test("speech protection attacks quickly, holds sentence endings, and releases smoothly", () => {
  let state = createSpeechProtectionState();
  for (let now = 0; now < 2_000; now += 16) {
    state = advanceSpeechProtection(state, 0.004, now);
  }
  assert.equal(state.active, false);

  state = advanceSpeechProtection(state, 0.025, 2_016);
  assert.equal(state.active, true);
  state = advanceSpeechProtection(state, 0.001, 2_016 + SPEECH_PROTECTION_HANGOVER_MS - 1);
  assert.equal(state.active, true);
  state = advanceSpeechProtection(state, 0.001, 2_016 + SPEECH_PROTECTION_HANGOVER_MS + 1);
  assert.equal(state.active, false);

  const firstAttack = approachSuppressionLevel(
    DEEPFILTER_BASE_SUPPRESSION_LEVEL,
    DEEPFILTER_SPEECH_SUPPRESSION_LEVEL,
    true,
  );
  const firstRelease = approachSuppressionLevel(
    DEEPFILTER_SPEECH_SUPPRESSION_LEVEL,
    DEEPFILTER_BASE_SUPPRESSION_LEVEL,
    false,
  );
  assert.ok(firstAttack < 28);
  assert.ok(firstRelease < 26);
  assert.equal(SPEECH_RAW_MIX + SPEECH_PROCESSED_MIX, 1);
});

test("DeepFilterNet is the only suppression engine and keeps raw audio on model failure", () => {
  const processor = readFileSync(
    path.join(root, "apps/desktop/src/renderer/src/features/audio/microphoneProcessor.ts"),
    "utf8",
  );
  const packageJson = readFileSync(path.join(root, "apps/desktop/package.json"), "utf8");
  const rendererHtml = readFileSync(
    path.join(root, "apps/desktop/src/renderer/index.html"),
    "utf8",
  );
  const constraints = readFileSync(
    path.join(root, "packages/webrtc/src/audioConstraints.ts"),
    "utf8",
  );
  assert.equal(processor.includes("DeepFilterNet3Core"), true);
  assert.equal(processor.includes("DEEPFILTER_BASE_SUPPRESSION_LEVEL = 34"), true);
  assert.equal(processor.includes("DEEPFILTER_SPEECH_SUPPRESSION_LEVEL = 24"), true);
  assert.equal(processor.includes("advanceSpeechProtection"), true);
  assert.equal(processor.includes("DEEPFILTER_RAW_ALIGNMENT_SECONDS"), true);
  assert.equal(processor.includes("rawProcessedMix"), true);
  assert.equal(processor.includes("getDeepFilterAssets"), true);
  assert.equal(processor.includes('noiseProcessor = "deepfilter_active"'), true);
  assert.equal(processor.includes('noiseProcessor = "deepfilter_unavailable"'), true);
  assert.equal(processor.includes("crossfade(context, processedGain, rawGain)"), true);
  assert.equal(processor.includes("enableBrowserNoiseSuppression"), false);
  assert.equal(
    constraints.includes("googTypingNoiseDetection: overrides.noiseSuppression ?? true"),
    true,
  );
  assert.equal(processor.includes("RNNoise"), false);
  assert.equal(processor.includes("MICROPHONE_PROCESSING_SAMPLE_RATE"), true);
  assert.equal(processor.includes("prewarmDeepFilterAssets"), true);
  assert.equal(processor.includes("ready: Promise<"), true);
  assert.match(rendererHtml, /script-src 'self' 'wasm-unsafe-eval' blob:/);
  assert.doesNotMatch(rendererHtml, /script-src[^;]*\s'unsafe-eval'/);
  assert.equal(packageJson.includes('"deepfilternet3-noise-filter": "1.2.1"'), true);
  assert.equal(packageJson.includes("@shiguredo/rnnoise-wasm"), false);
  assert.equal(existsSync(path.join(root, "apps/desktop/resources/deepfilter/df_bg.wasm")), true);
  assert.equal(
    existsSync(path.join(root, "apps/desktop/resources/deepfilter/DeepFilterNet3_onnx.tar.gz")),
    true,
  );
});

test("remote audio uses one shared mixer with silent per-stream decoder pumps", () => {
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
  assert.equal(mixer.includes("createDecoderPump(input.peerId, input.stream)"), true);
  assert.equal(mixer.includes('document.createElement("audio")'), true);
  assert.equal(mixer.includes("element.muted = true"), true);
  assert.equal(mixer.includes("channel.decoderPump.srcObject = null"), true);
  assert.equal(mixer.includes("createDynamicsCompressor"), true);
  assert.equal(mixer.includes("this.isDeafened ? 0 : this.masterVolume"), true);
  assert.equal(mixer.includes("clampMemberVolume(webRtcChannel.volume)"), true);
  assert.equal(mixer.includes("channels = new Map"), true);
  assert.equal(mixer.includes("relayChannels = new Map"), true);
  assert.equal(mixer.includes("playRelaySamples"), true);
  assert.equal(mixer.includes("getRemoteAudioMixer"), true);
  assert.equal(mixer.includes("getDiagnostics(): RemoteAudioMixerDiagnostics"), true);
  assert.equal(mixer.includes("hasWebRtcPlaybackChannel"), true);
  assert.equal(mixer.includes("hasVerifiedWebRtcPlayback"), true);
  assert.equal(mixer.includes("WebRTC playback graph verified by audio"), true);
  assert.equal(mixer.includes("source.connect(analyser)"), true);
  assert.equal(mixer.includes("analyser.connect(gain)"), true);
  assert.equal(mixer.includes("Shared audio mixer fell back to default output"), true);
  assert.equal(mixer.includes("this.resetRelayQueue(relayChannel, context)"), false);
  assert.equal(mixer.includes(".suspend()"), false);
  assert.equal(mixer.includes('this.outputDeviceId || "default"'), true);
  assert.equal(home.includes('unlock("enter-channel")'), true);
  assert.equal(renderer.includes('addEventListener?.("devicechange", recoverOutput)'), true);
  assert.equal(relay.includes("getRemoteAudioMixer"), true);
  assert.equal(relay.includes('unlock("signaling-audio-relay")'), true);
  assert.equal(relay.includes("new FallbackAudioPlayer(message.peerId)"), true);
  assert.equal(main.includes('appendSwitch("autoplay-policy", "no-user-gesture-required")'), true);
});

test("remote audio never silences an available path while the requested path is not playable", () => {
  assert.equal(
    resolveRemoteAudioPath({
      requestedPath: "webrtc",
      hasWebRtcChannel: false,
      hasVerifiedWebRtcAudio: false,
      hasRelayChannel: true,
    }),
    "relay",
  );
  assert.equal(
    resolveRemoteAudioPath({
      requestedPath: "relay",
      hasWebRtcChannel: true,
      hasVerifiedWebRtcAudio: true,
      hasRelayChannel: false,
    }),
    "webrtc",
  );
  assert.equal(
    resolveRemoteAudioPath({
      hasWebRtcChannel: true,
      hasVerifiedWebRtcAudio: true,
      hasRelayChannel: true,
    }),
    "webrtc",
  );
});

test("legacy screen-frame fallback is isolated from audio readiness", () => {
  const screenShareCoordinator = readFileSync(
    path.join(
      root,
      "apps/desktop/src/renderer/src/features/screen-share/RoomScreenShareCoordinator.ts",
    ),
    "utf8",
  );

  const start = screenShareCoordinator.indexOf("private getRelayTargets");
  const end = screenShareCoordinator.indexOf("private updateRelay", start);
  const targetSelection = screenShareCoordinator.slice(start, end);
  assert.equal(targetSelection.includes("relayRequestedByPeerIds"), true);
  assert.equal(targetSelection.includes("webrtcReadyPeerIds"), false);
});

test("member playback volume is local, bounded to 300%, and restores after local mute", () => {
  assert.equal(clampMemberVolume(-1), 0);
  assert.equal(clampMemberVolume(1.35), 1.35);
  assert.equal(clampMemberVolume(3.5), 3);
  assert.equal(memberVolumeToPercent(3), 300);
  assert.equal(toggleLocalMemberMute(1.35, 1), 0);
  assert.equal(toggleLocalMemberMute(0, 1.35), 1.35);
  assert.equal(toggleLocalMemberMute(0, 0), 1);
});

test("friend loudness balance learns speech without lifting silence or overriding local volume", () => {
  let silent = createLoudnessBalanceState();
  for (let index = 0; index < 100; index += 1) {
    silent = advanceLoudnessBalance(silent, {
      rms: 0.001,
      peak: 0.004,
      now: index * 66,
      enabled: true,
    });
  }
  assert.equal(silent.gain, 1);

  let quiet = createLoudnessBalanceState();
  for (let index = 0; index < 120; index += 1) {
    quiet = advanceLoudnessBalance(quiet, {
      rms: 0.05,
      peak: 0.14,
      now: index * 66,
      enabled: true,
    });
  }
  assert.equal(FRIEND_LOUDNESS_TARGET_LUFS, -14);
  assert.ok(quiet.gain > 1.8);

  let loud = createLoudnessBalanceState();
  for (let index = 0; index < 60; index += 1) {
    loud = advanceLoudnessBalance(loud, {
      rms: 0.35,
      peak: 0.8,
      now: index * 66,
      enabled: true,
    });
  }
  assert.ok(loud.gain < 0.8);
  assert.equal(applyLoudnessBalanceToMemberVolume(0, quiet.gain, true), 0);
  assert.equal(applyLoudnessBalanceToMemberVolume(1.5, 2, true), 3);
  assert.equal(applyLoudnessBalanceToMemberVolume(1.5, 2, false), 1.5);

  const learnedGain = quiet.gain;
  for (let index = 0; index < 80; index += 1) {
    quiet = advanceLoudnessBalance(quiet, {
      rms: 0.001,
      peak: 0.004,
      now: 8_000 + FRIEND_LOUDNESS_HANGOVER_MS + index * 66,
      enabled: true,
    });
  }
  assert.ok(quiet.gain < learnedGain * 0.75);
  const silentGain = quiet.gain;
  quiet = advanceLoudnessBalance(quiet, {
    rms: 0.05,
    peak: 0.14,
    now: 14_000,
    enabled: true,
  });
  assert.ok(quiet.gain > silentGain);
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
