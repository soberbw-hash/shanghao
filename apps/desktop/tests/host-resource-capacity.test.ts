import assert from "node:assert/strict";
import test from "node:test";
import { HostCapacitySampler, parseGpuFreeBytes } from "../src/main/host-resource-capacity";
import { ResourceScheduler } from "../src/main/resource-scheduler";

test("GPU capacity uses free memory of CUDA device 0, not a multi-GPU sum", () => {
  assert.equal(parseGpuFreeBytes("8192, 1024\n24576, 24000"), 1024 ** 3);
  for (const value of ["N/A, N/A", "", "8192,", "0, 10", "8192, -1", "8192, 9000"])
    assert.equal(parseGpuFreeBytes(value), undefined);
});

test("CPU deltas, memory and free VRAM are demand sampled with a shared in-flight result", async () => {
  let now = 1;
  let gpuCalls = 0;
  let cpuTotal = 100;
  let complete: (value: number | undefined) => void = () => undefined;
  const sampler = new HostCapacitySampler(
    () => ({ total: cpuTotal, idle: 10 }),
    () => 3 * 1024 ** 3,
    () => {
      gpuCalls += 1;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    () => now,
    10,
  );
  const first = sampler.refresh();
  assert.equal(sampler.refresh(), first);
  await Promise.resolve();
  complete(100 * 1024 ** 2);
  await first;
  assert.equal(gpuCalls, 1);
  assert.equal(sampler.current().cpuBusyRatio, undefined);
  await sampler.refresh();
  assert.equal(gpuCalls, 1);
  now += 11;
  cpuTotal += 100;
  const second = sampler.refresh();
  await Promise.resolve();
  complete(undefined);
  await second;
  assert.equal(sampler.current().cpuBusyRatio, 1);
  assert.equal(sampler.current().gpuFreeBytes, undefined);
});

test("missing GPU telemetry is unknown, and a failed probe is cached rather than retried per render", async () => {
  let calls = 0;
  const sampler = new HostCapacitySampler(
    () => ({ total: 1, idle: 1 }),
    () => 4 * 1024 ** 3,
    async () => {
      calls++;
      throw new Error("nvidia-smi unavailable");
    },
  );
  await sampler.refresh();
  await sampler.refresh();
  assert.equal(calls, 1);
  assert.equal(sampler.current().gpuFreeBytes, undefined);
});

test("CPU/VRAM pressure reduces manual compute; automatic work yields under room pressure", () => {
  const scheduler = new ResourceScheduler(() => 4 * 1024 ** 3, {
    refresh: async () => undefined,
    current: () => ({
      sampledAt: 1,
      availableMemoryBytes: 4 * 1024 ** 3,
      cpuBusyRatio: 0.97,
      gpuFreeBytes: 100 * 1024 ** 2,
    }),
  });
  assert.equal(scheduler.aiDecision("transcription", true).resourceMode, "low");
  scheduler.update({
    processingMode: "immediate",
    pressure: {
      inVoiceRoom: true,
      screenSharing: false,
      peerRecovering: false,
      latencyMs: 0,
      packetLossPercent: 0,
      rendererMemoryPressure: false,
      updatedAt: 1,
    },
  });
  assert.equal(scheduler.aiDecision("summary", false).runnable, false);
  scheduler.close();
});
