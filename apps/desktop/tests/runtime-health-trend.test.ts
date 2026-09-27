import assert from "node:assert/strict";
import test from "node:test";

import type { RuntimeHealthSnapshot } from "@private-voice/shared";

import { analyzeRuntimeHealthTrend } from "../src/main/runtime-health-trend";

const sample = (index: number, growth = false, phaseId = 1): RuntimeHealthSnapshot => ({
  capturedAt: new Date(index * 60_000).toISOString(),
  appVersion: "3.0.8",
  protocolVersion: "7",
  buildNumber: "test",
  uptimeMs: index * 60_000,
  main: {
    pid: 1,
    type: "Browser",
    workingSetBytes: 100 * 1024 * 1024 + (growth ? index * 16 * 1024 * 1024 : 0),
  },
  renderer: {
    pid: 2,
    type: "Tab",
    workingSetBytes: 200 * 1024 * 1024 + (growth ? index * 24 * 1024 * 1024 : 0),
    domNodeCount: 1_000 + (growth ? index * 100 : 0),
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
    phaseId,
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
  const trend = analyzeRuntimeHealthTrend(Array.from({ length: 12 }, (_, index) => sample(index)));
  assert.deepEqual(trend.warnings, []);
});

test("runtime trend reports sustained process, memory and realtime growth", () => {
  const trend = analyzeRuntimeHealthTrend(
    Array.from({ length: 12 }, (_, index) => sample(index, true)),
  );
  assert.ok(trend.warnings.includes("main_working_set_growth"));
  assert.ok(trend.warnings.includes("renderer_working_set_growth"));
  assert.ok(trend.warnings.includes("child_process_growth"));
  assert.ok(trend.warnings.includes("dom_node_growth"));
  assert.ok(trend.warnings.includes("audio_context_growth"));
});

test("runtime trend resets after a room or device phase change", () => {
  const samples = Array.from({ length: 12 }, (_, index) => sample(index, true, index < 6 ? 1 : 2));
  assert.deepEqual(analyzeRuntimeHealthTrend(samples).warnings, []);
});

test("runtime trend ignores isolated endpoint spikes and GC-like fluctuations", () => {
  const samples = Array.from({ length: 12 }, (_, index) => sample(index));
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) throw new Error("test samples missing");
  first.main.workingSetBytes = 80 * 1024 * 1024;
  last.main.workingSetBytes = 300 * 1024 * 1024;
  assert.deepEqual(analyzeRuntimeHealthTrend(samples).warnings, []);
});
