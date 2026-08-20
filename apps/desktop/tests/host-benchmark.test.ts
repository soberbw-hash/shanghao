import assert from "node:assert/strict";
import test from "node:test";

import { summarizeHostBenchmark, type HostBenchmarkSample } from "../src/main/host-benchmark-core";

const sample = (cpuPercent: number, residentMemoryBytes: number): HostBenchmarkSample => ({
  host: "electron",
  capturedAt: "2026-08-20T00:00:00.000Z",
  uptimeMs: 1_000,
  cpuPercent,
  residentMemoryBytes,
  heapUsedBytes: 1,
  displayRefreshRateHz: 60,
  gpuFeatureStatus: {},
});

test("host benchmark summary uses bounded distribution metrics instead of one sample", () => {
  const summary = summarizeHostBenchmark([
    sample(1, 100),
    sample(2, 200),
    sample(3, 300),
    sample(100, 1_000),
  ]);
  assert.equal(summary.sampleCount, 4);
  assert.equal(summary.cpuP50, 2);
  assert.equal(summary.cpuP95, 100);
  assert.equal(summary.residentMemoryP50Bytes, 200);
  assert.equal(summary.residentMemoryP95Bytes, 1_000);
});
