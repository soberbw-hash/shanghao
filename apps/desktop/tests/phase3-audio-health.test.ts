import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { advancePeerHealth, createPeerHealthState } from "../../../packages/webrtc/src/peerHealth";
import { collectPeerAudioStats } from "../../../packages/webrtc/src/stats";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("extended WebRTC audio stats retain browser concealment and jitter-buffer evidence", async () => {
  const reports = new Map<string, Record<string, unknown>>([
    [
      "audio",
      {
        id: "audio",
        type: "inbound-rtp",
        kind: "audio",
        jitter: 0.032,
        packetsLost: 4,
        packetsReceived: 96,
        bytesReceived: 24_000,
        totalSamplesReceived: 48_000,
        concealedSamples: 2_400,
        concealmentEvents: 3,
        silentConcealedSamples: 600,
        jitterBufferDelay: 4,
        jitterBufferTargetDelay: 5,
        jitterBufferEmittedCount: 100,
        packetsDiscarded: 2,
        fecPacketsReceived: 7,
        fecPacketsDiscarded: 1,
      },
    ],
  ]);
  const connection = { getStats: async () => reports } as unknown as RTCPeerConnection;
  const stats = await collectPeerAudioStats(connection);
  assert.equal(stats.concealmentEvents, 3);
  assert.equal(stats.silentConcealedSamples, 600);
  assert.equal(stats.averageJitterBufferDelayMs, 40);
  assert.equal(stats.averageJitterBufferTargetDelayMs, 50);
  assert.equal(stats.packetsDiscarded, 2);
  assert.equal(stats.fecPacketsReceived, 7);
});

test("peer health separates network damage from a local media stall", () => {
  const network = advancePeerHealth(createPeerHealthState(), {
    peerId: "peer-a",
    stats: {
      packetLossPercent: 9,
      jitterMs: 100,
      roundTripTimeMs: 450,
      concealmentPercent: 12,
      inboundAudioFlow: "flowing",
      connectionType: "relay",
    },
    iceState: "connected",
    packetsProgressing: true,
  }).snapshot!;
  assert.equal(network.degradationSource, "network");
  assert.equal(network.level, "critical");

  const pipeline = advancePeerHealth(createPeerHealthState(), {
    peerId: "peer-b",
    stats: {
      packetLossPercent: 0,
      jitterMs: 4,
      roundTripTimeMs: 35,
      concealmentPercent: 0,
      inboundAudioFlow: "stalled",
      connectionType: "p2p",
    },
    iceState: "connected",
    packetsProgressing: false,
  }).snapshot!;
  assert.equal(pipeline.degradationSource, "media_pipeline");
  assert.equal(pipeline.audioFlow, "stalled");
});

test("natural voice enhancement runs after DeepFilter blend without pre-boosting air", () => {
  const source = read("apps/desktop/src/renderer/src/features/audio/microphoneProcessor.ts");
  assert.equal(source.includes("VOICE_ENHANCEMENT_EQ_GAINS"), false);
  assert.match(
    source,
    /connectNaturalVoiceEnhancer\([\s\S]*blendBus[\s\S]*equalized\.connect\(outputGain\)/,
  );
  assert.match(
    source,
    /processor\.node\.connect\(gain\);[\s\S]*gain\.connect\(protectionWorklet, 0, 1\)/,
  );
  assert.match(source, /protectionWorklet\.connect\(blendBus\)/);
  assert.equal(source.includes("gain.connect(outputGain)"), false);
  assert.match(source, /airRestraint\.gain\.value = -0\.8/);
  assert.match(source, /compressor\.ratio\.value = 1\.6/);
});

test("a stalled friend repairs only that playback graph before peer ICE recovery", () => {
  const room = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const mixer = read("apps/desktop/src/renderer/src/features/audio/RemoteAudioMixer.ts");
  const repairIndex = room.indexOf("repairPeerPlayback(peerId)");
  const recoveryIndex = room.indexOf('peerRecovery.schedule(peerId, "inbound_rtp_stalled")');
  assert.ok(repairIndex >= 0 && recoveryIndex > repairIndex);
  assert.match(mixer, /async repairPeerPlayback\(peerId: string\)/);
  assert.match(mixer, /targeted-peer-playback-repair/);
});

test("long-session diagnostics expose bounded mixer resource counts", () => {
  const mixer = read("apps/desktop/src/renderer/src/features/audio/RemoteAudioMixer.ts");
  const settings = read("apps/desktop/src/renderer/src/pages/SettingsPage.tsx");
  assert.match(mixer, /audioContextCount: this\.context \? 1 : 0/);
  assert.match(mixer, /this\.channels\.size \* 3 \+ this\.relayChannels\.size \* 2/);
  assert.match(settings, /audioNodeCount: mixerHealth\?\.audioNodeCount/);
  assert.match(settings, /timerCount: mixerHealth\?\.timerCount/);
});

test("remote playback ramps in instead of exposing the GainNode default on join", () => {
  const mixer = read("apps/desktop/src/renderer/src/features/audio/RemoteAudioMixer.ts");
  assert.match(mixer, /REMOTE_AUDIO_GAIN_RAMP_SECONDS = 0\.045/);
  assert.ok(
    (mixer.match(/gain\.gain\.setValueAtTime\(0, context\.currentTime\)/g) ?? []).length >= 2,
  );
  assert.match(mixer, /gain\.gain\.setTargetAtTime\([\s\S]*REMOTE_AUDIO_GAIN_RAMP_SECONDS/);
  assert.match(mixer, /channel\.gain\.gain\.cancelScheduledValues\(context\.currentTime\)/);
});
