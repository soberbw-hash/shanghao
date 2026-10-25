import assert from "node:assert/strict";
import test from "node:test";
import {
  intervalPeerAudioStats,
  evaluatePeerPlayoutQuality,
} from "../../../packages/webrtc/src/audioStatsInterval";
import { collectPeerAudioStats } from "../../../packages/webrtc/src/stats";
import { selectNetworkTier } from "../../../packages/webrtc/src/createPeer";
import { advancePeerHealth, createPeerHealthState } from "../../../packages/webrtc/src/peerHealth";

test("recent loss and playout damage are not hidden by hours of healthy RTP history", () => {
  const before = {
    inboundStreamId: "a",
    packetsReceived: 100000,
    packetsLost: 0,
    totalSamplesReceived: 480000000,
    concealedSamples: 1000,
    jitterBufferDelayMs: 1000000,
    jitterBufferEmittedCount: 1000000,
  };
  const current = {
    ...before,
    packetsReceived: 100080,
    packetsLost: 20,
    totalSamplesReceived: 480048000,
    concealedSamples: 25000,
    jitterBufferDelayMs: 1035000,
    jitterBufferEmittedCount: 1000050,
    packetLossPercent: 0.02,
    concealmentPercent: 0.01,
  };
  const interval = intervalPeerAudioStats(current, before);
  assert.equal(interval.packetLossPercent, 20);
  assert.equal(interval.concealmentPercent, 50);
  assert.equal(interval.averageJitterBufferDelayMs, 700);
  assert.equal(interval.packetsReceived, current.packetsReceived);
  const recovered = intervalPeerAudioStats(
    {
      ...current,
      packetsReceived: 100180,
      totalSamplesReceived: 480096000,
      jitterBufferDelayMs: 1037000,
      jitterBufferEmittedCount: 1000100,
    },
    current,
  );
  assert.equal(recovered.packetLossPercent, 0);
  assert.equal(recovered.concealmentPercent, 0);
  assert.equal(recovered.averageJitterBufferDelayMs, 40);
  assert.equal(
    intervalPeerAudioStats({ ...current, inboundStreamId: "new" }, before).packetLossPercent,
    0.02,
  );
});

test("sustained unusable speech requests targeted recovery even when packets still advance", () => {
  const active = { speaking: true, muted: false, packetsProgressing: true };
  let state;
  for (let i = 0; i < 3; i++) {
    state = evaluatePeerPlayoutQuality({ concealmentPercent: 40 }, state, active);
    assert.equal(state.stalled, false);
  }
  state = evaluatePeerPlayoutQuality({ concealmentPercent: 40 }, state, active);
  assert.equal(state.stalled, true);
  for (let i = 0; i < 2; i++) {
    state = evaluatePeerPlayoutQuality({ concealmentPercent: 0 }, state, active);
    assert.equal(state.stalled, true);
  }
  assert.equal(evaluatePeerPlayoutQuality({}, state, active).stalled, false);
  assert.equal(
    evaluatePeerPlayoutQuality({ concealmentPercent: 100 }, state, { ...active, muted: true })
      .stalled,
    false,
  );
  assert.equal(
    evaluatePeerPlayoutQuality({ receivedSamplesDelta: 0 }, state, { ...active, speaking: false })
      .stalled,
    false,
  );
});

test("latency follows the audio transport's selected pair instead of an older nominated candidate", async () => {
  const report = new Map([
    ["audio", { id: "audio", type: "inbound-rtp", kind: "audio", transportId: "audio-transport" }],
    [
      "active",
      {
        id: "active",
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime: 0.035,
      },
    ],
    [
      "old",
      {
        id: "old",
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime: 1.2,
      },
    ],
    [
      "audio-transport",
      { id: "audio-transport", type: "transport", selectedCandidatePairId: "active" },
    ],
    ["sender", { id: "sender", type: "outbound-rtp", kind: "audio", packetsSent: 2000 }],
    [
      "remote-audio",
      {
        id: "remote-audio",
        type: "remote-inbound-rtp",
        kind: "audio",
        localId: "sender",
        fractionLost: 0.4,
      },
    ],
  ]);
  const stats = await collectPeerAudioStats({
    getStats: async () => report,
  } as unknown as RTCPeerConnection);
  assert.equal(stats.roundTripTimeMs, 35);
  assert.equal(stats.outboundPacketLossPercent, 40);
  assert.equal(stats.outboundPacketsSent, 2000);
  assert.equal(
    selectNetworkTier({ packetLossPercent: 0, outboundPacketLossPercent: 40 }),
    "critical",
  );
  assert.equal(
    advancePeerHealth(createPeerHealthState(), {
      peerId: "peer",
      stats,
      iceState: "connected",
      packetsProgressing: true,
    }).snapshot?.degradationSource,
    "network",
  );
});
