import assert from "node:assert/strict";
import test from "node:test";

import type { AiRuntimePressure } from "@private-voice/shared";

import {
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND,
  RESOURCE_PRIORITY,
  ResourceScheduler,
} from "../src/main/resource-scheduler";

const pressure = (overrides: Partial<AiRuntimePressure>): AiRuntimePressure => ({
  inVoiceRoom: false,
  screenSharing: false,
  peerRecovering: false,
  latencyMs: 0,
  packetLossPercent: 0,
  rendererMemoryPressure: false,
  updatedAt: Date.now(),
  ...overrides,
});

test("resource priority keeps realtime room work ahead of AI and downloads", () => {
  assert.ok(RESOURCE_PRIORITY.realtimeVoice > RESOURCE_PRIORITY.peerRecovery);
  assert.ok(RESOURCE_PRIORITY.peerRecovery > RESOURCE_PRIORITY.screenShare);
  assert.ok(RESOURCE_PRIORITY.recording > RESOURCE_PRIORITY.aiInference);
  assert.ok(RESOURCE_PRIORITY.aiOrganization > RESOURCE_PRIORITY.backgroundDownload);
});

test("resource scheduler throttles and yields background work during realtime pressure", () => {
  const scheduler = new ResourceScheduler();
  assert.equal(scheduler.downloadBytesPerSecond(), NORMAL_DOWNLOAD_BYTES_PER_SECOND);
  scheduler.update({ gameActive: true });
  assert.equal(scheduler.downloadBytesPerSecond(), GAMING_DOWNLOAD_BYTES_PER_SECOND);
  scheduler.update({
    gameActive: false,
    pressure: pressure({ inVoiceRoom: true, screenSharing: true }),
  });
  assert.equal(scheduler.downloadBytesPerSecond(), REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND);
  assert.equal(scheduler.aiDecision("summary", false).resourceMode, "low");
  scheduler.update({ realtimePressureHigh: true, pressureReason: "peer_recovery" });
  assert.deepEqual(scheduler.aiDecision("transcription", false), {
    runnable: false,
    reason: "peer_recovery",
    resourceMode: "low",
  });
  assert.equal(scheduler.aiDecision("transcription", true).runnable, true);
  assert.deepEqual(scheduler.shouldReleaseQwen(), { release: true, reason: "peer_recovery" });
});
