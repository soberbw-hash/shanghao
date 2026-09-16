import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeHealthSnapshot } from "@private-voice/shared";

import { analyzeRuntimeHealthTrend } from "../src/main/runtime-health-trend";

const sample = (index: number, growth = false): RuntimeHealthSnapshot => ({
  capturedAt: new Date(index * 2_000).toISOString(),
  appVersion: "3.0.8",
  protocolVersion: "7",
  buildNumber: "test",
  uptimeMs: index * 2_000,
  main: {
    pid: 1,
    type: "Browser",
    workingSetBytes: 100 * 1024 * 1024 + (growth ? index * 16 * 1024 * 1024 : 0),
  },
  renderer: {
    pid: 2,
    type: "Tab",
    workingSetBytes: 200 * 1024 * 1024 + (growth ? index * 24 * 1024 * 1024 : 0),
  },
  processes: growth
    ? Array.from({ length: 2 + Math.floor(index / 2) }, (_, pid) => ({ pid, type: "Utility" }))
    : [
        { pid: 1, type: "Browser" },
        { pid: 2, type: "Tab" },
      ],
  system: {},
  gpu: { hardwareAcceleration: true, featureStatus: {} },
  display: { id: "1", scaleFactor: 1, width: 1_920, height: 1_080 },
  realtime: {
    peerCount: 2,
    reconnectAttempts: 0,
    trackCount: growth ? index : 2,
    audioNodeCount: growth ? index * 2 : 4,
    audioContextCount: growth ? index : 1,
    timerCount: growth ? index * 2 : 2,
    listenerCount: growth ? index * 4 : 4,
    screenShareActive: false,
    screenFallbackActive: false,
  },
  queues: {},
  flightRecorder: { capturedAt: new Date(0).toISOString(), events: [], droppedEvents: 0 },
});

test("runtime trend stays quiet for stable resource counts", () => {
  const trend = analyzeRuntimeHealthTrend(Array.from({ length: 8 }, (_, index) => sample(index)));
  assert.deepEqual(trend.warnings, []);
});

test("runtime trend reports sustained process, memory and realtime growth", () => {
  const trend = analyzeRuntimeHealthTrend(
    Array.from({ length: 8 }, (_, index) => sample(index, true)),
  );
  assert.ok(trend.warnings.includes("main_working_set_growth"));
  assert.ok(trend.warnings.includes("renderer_working_set_growth"));
  assert.ok(trend.warnings.includes("child_process_growth"));
  assert.ok(trend.warnings.includes("audio_context_growth"));
});
