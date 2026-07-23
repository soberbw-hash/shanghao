import assert from "node:assert/strict";
import test from "node:test";

import { evaluateInboundAudioFlow, selectNetworkTier } from "@private-voice/webrtc";

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
  assert.equal(progress.status, "warming");

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
