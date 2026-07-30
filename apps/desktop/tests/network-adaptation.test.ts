import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInboundAudioFlow, selectNetworkTier } from "@private-voice/webrtc";

import {
  isPeerAudioPathReady,
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

test("a live WebRTC track cannot disable relay before inbound RTP is verified", () => {
  const trackOnly = {
    isConnected: true,
    hasAudioTrack: true,
    hasInboundRtpFlow: false,
    isStalled: false,
  };
  assert.equal(isPeerAudioPathReady(trackOnly), false);
  assert.equal(shouldUseAudioRelay(trackOnly), true);

  const verified = { ...trackOnly, hasInboundRtpFlow: true };
  assert.equal(isPeerAudioPathReady(verified), true);
  assert.equal(shouldUseAudioRelay(verified), false);

  const stalled = { ...verified, isStalled: true };
  assert.equal(isPeerAudioPathReady(stalled), false);
  assert.equal(shouldUseAudioRelay(stalled), true);
  assert.equal(
    shouldSendAudioRelay({
      evidence: verified,
      isRelayRequested: false,
      nowMs: 1_000,
      relayWarmupUntilMs: 5_000,
    }),
    true,
  );
  assert.equal(
    shouldSendAudioRelay({
      evidence: verified,
      isRelayRequested: false,
      nowMs: 5_001,
      relayWarmupUntilMs: 5_000,
    }),
    false,
  );
  assert.equal(
    shouldSendAudioRelay({
      evidence: verified,
      isRelayRequested: true,
      nowMs: 5_001,
      relayWarmupUntilMs: 5_000,
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
