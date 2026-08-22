import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInboundAudioFlow, selectNetworkTier } from "@private-voice/webrtc";

import {
  isPeerAudioPathReady,
  shouldRequestRelayResync,
  shouldSendAudioRelay,
  shouldUseAudioRelay,
} from "../src/renderer/src/features/room/peerAudioPath";

test("network adaptation ignores an unavailable zero bitrate estimate", () => {
  assert.equal(
    selectNetworkTier({
      packetLossPercent: 0,
      roundTripTimeMs: 36,
      jitterMs: 4,
      availableOutgoingBitrateBps: 0,
    }),
    "healthy",
  );
});

test("network adaptation protects audio when measured uplink is constrained", () => {
  assert.equal(
    selectNetworkTier({
      packetLossPercent: 1,
      roundTripTimeMs: 70,
      jitterMs: 9,
      availableOutgoingBitrateBps: 180_000,
    }),
    "constrained",
  );
  assert.equal(
    selectNetworkTier({
      packetLossPercent: 2,
      roundTripTimeMs: 90,
      jitterMs: 12,
      availableOutgoingBitrateBps: 80_000,
    }),
    "critical",
  );
});

test("packet loss, jitter, and latency can independently trigger degradation", () => {
  assert.equal(selectNetworkTier({ packetLossPercent: 3 }), "constrained");
  assert.equal(selectNetworkTier({ jitterMs: 90 }), "critical");
  assert.equal(selectNetworkTier({ roundTripTimeMs: 420 }), "critical");
});

test("concealment and jitter-buffer growth independently trigger degradation", () => {
  assert.equal(selectNetworkTier({ concealmentPercent: 5 }), "constrained");
  assert.equal(selectNetworkTier({ concealmentPercent: 14 }), "critical");
  assert.equal(selectNetworkTier({ averageJitterBufferDelayMs: 150 }), "constrained");
  assert.equal(selectNetworkTier({ averageJitterBufferDelayMs: 300 }), "critical");
});

test("repeatable weak-network matrix keeps the existing conservative bitrate tiers", () => {
  const lossMatrix = [1, 3, 5, 8, 10, 15].map((packetLossPercent) => ({
    packetLossPercent,
    tier: selectNetworkTier({ packetLossPercent }),
  }));
  assert.deepEqual(
    lossMatrix.map((sample) => sample.tier),
    ["healthy", "constrained", "constrained", "critical", "critical", "critical"],
  );
  assert.equal(selectNetworkTier({ packetLossPercent: 5, jitterMs: 95 }), "critical");
  assert.equal(selectNetworkTier({ packetLossPercent: 1, jitterMs: 50 }), "constrained");
});

test("inbound audio flow detects a connected peer that silently stopped receiving RTP", () => {
  const connectedAtMs = 1_000;
  let progress = evaluateInboundAudioFlow(
    { bytesReceived: 3_200, packetsReceived: 20 },
    undefined,
    { nowMs: connectedAtMs, connectedAtMs, isRemoteMuted: false },
  );
  assert.equal(progress.status, "flowing");

  for (const nowMs of [5_100, 6_100]) {
    progress = evaluateInboundAudioFlow(
      { bytesReceived: 3_200, packetsReceived: 20 },
      progress.next,
      { nowMs, connectedAtMs, isRemoteMuted: false },
    );
    assert.equal(progress.status, "warming");
  }
  progress = evaluateInboundAudioFlow(
    { bytesReceived: 3_200, packetsReceived: 20 },
    progress.next,
    { nowMs: 7_100, connectedAtMs, isRemoteMuted: false },
  );
  assert.equal(progress.status, "stalled");

  progress = evaluateInboundAudioFlow(
    { bytesReceived: 3_840, packetsReceived: 24 },
    progress.next,
    { nowMs: 8_100, connectedAtMs, isRemoteMuted: false },
  );
  assert.equal(progress.status, "flowing");
  assert.equal(progress.next.stagnantSamples, 0);
});

test("inbound audio flow treats verified Opus DTX silence as healthy until the peer speaks", () => {
  const previous = { bytesReceived: 3_200, packetsReceived: 20, stagnantSamples: 2 };
  const quiet = evaluateInboundAudioFlow({ bytesReceived: 3_200, packetsReceived: 20 }, previous, {
    nowMs: 10_000,
    connectedAtMs: 1_000,
    isRemoteMuted: false,
    isRemoteSpeaking: false,
  });
  assert.equal(quiet.status, "flowing");
  assert.equal(quiet.progressed, false);
  assert.equal(quiet.next.stagnantSamples, 0);

  const speaking = evaluateInboundAudioFlow(
    { bytesReceived: 3_200, packetsReceived: 20 },
    { ...quiet.next, stagnantSamples: 2 },
    {
      nowMs: 11_000,
      connectedAtMs: 1_000,
      isRemoteMuted: false,
      isRemoteSpeaking: true,
    },
  );
  assert.equal(speaking.status, "stalled");
});

test("relay watchdog does not resync normal gated silence or repeat the same failed packet", () => {
  assert.equal(
    shouldRequestRelayResync({
      now: 8_000,
      lastReceivedAt: 4_000,
      lastPlayedAt: 4_000,
    }),
    false,
  );
  assert.equal(
    shouldRequestRelayResync({
      now: 5_500,
      lastReceivedAt: 5_400,
      lastPlayedAt: 4_000,
    }),
    true,
  );
  assert.equal(
    shouldRequestRelayResync({
      now: 6_500,
      lastReceivedAt: 5_400,
      lastPlayedAt: 4_000,
      lastResyncRequestedAt: 5_500,
      lastResyncReceivedAt: 5_400,
    }),
    false,
  );
  assert.equal(
    shouldRequestRelayResync({
      now: 11_000,
      lastReceivedAt: 10_900,
      lastPlayedAt: 4_000,
      lastResyncRequestedAt: 5_500,
      lastResyncReceivedAt: 5_400,
    }),
    true,
  );
});

test("a live WebRTC track cannot disable relay before inbound RTP is verified", () => {
  const trackOnly = {
    isConnected: true,
    hasAudioTrack: true,
    hasInboundRtpFlow: false,
    hasPlaybackChannel: false,
    isStalled: false,
  };
  assert.equal(isPeerAudioPathReady(trackOnly), false);
  assert.equal(shouldUseAudioRelay(trackOnly), true);

  const rtpOnly = { ...trackOnly, hasInboundRtpFlow: true };
  assert.equal(isPeerAudioPathReady(rtpOnly), false);
  assert.equal(shouldUseAudioRelay(rtpOnly), true);

  const verified = { ...rtpOnly, hasPlaybackChannel: true };
  assert.equal(isPeerAudioPathReady(verified), true);
  assert.equal(shouldUseAudioRelay(verified), false);

  const stalled = { ...verified, isStalled: true };
  assert.equal(isPeerAudioPathReady(stalled), false);
  assert.equal(shouldUseAudioRelay(stalled), true);
  assert.equal(
    shouldSendAudioRelay({
      evidence: verified,
      isRelayRequested: false,
    }),
    false,
  );
  assert.equal(
    shouldSendAudioRelay({
      evidence: verified,
      isRelayRequested: true,
    }),
    true,
  );
});

test("five-person rooms keep every unverified directed audio route on relay", () => {
  const peerIds = ["A", "B", "C", "D", "E"];
  const routes = peerIds.flatMap((source) =>
    peerIds.filter((target) => target !== source).map((target) => `${source}->${target}`),
  );
  assert.equal(routes.length, 20);

  const verifiedRoutes = new Set(routes.filter((route) => !route.endsWith("->E")));
  const relayRoutes = routes.filter((route) =>
    shouldUseAudioRelay({
      isConnected: true,
      hasAudioTrack: true,
      hasInboundRtpFlow: verifiedRoutes.has(route),
      hasPlaybackChannel: verifiedRoutes.has(route),
      isStalled: false,
    }),
  );
  assert.deepEqual(relayRoutes.sort(), ["A->E", "B->E", "C->E", "D->E"]);
});

test("inbound audio flow never treats a muted peer or reset RTP counter as broken", () => {
  const previous = { bytesReceived: 4_000, packetsReceived: 30, stagnantSamples: 2 };
  const muted = evaluateInboundAudioFlow({ bytesReceived: 4_000, packetsReceived: 30 }, previous, {
    nowMs: 10_000,
    connectedAtMs: 1_000,
    isRemoteMuted: true,
  });
  assert.equal(muted.status, "muted");
  assert.equal(muted.next.stagnantSamples, 0);

  const reset = evaluateInboundAudioFlow({ bytesReceived: 200, packetsReceived: 2 }, previous, {
    nowMs: 11_000,
    connectedAtMs: 1_000,
    isRemoteMuted: false,
  });
  assert.equal(reset.status, "warming");
  assert.equal(reset.next.stagnantSamples, 0);
});
