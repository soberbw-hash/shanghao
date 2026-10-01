import assert from "node:assert/strict";
import test from "node:test";
import { ResourceWorkLane } from "../src/main/resource-work-lane";
import { ResourceScheduler } from "../src/main/resource-scheduler";

const capacity = {
  refresh: async () => undefined,
  current: () => ({ availableMemoryBytes: 4 * 1024 ** 3, sampledAt: 1 }),
};

test("CPU installations are exclusive and ASR conversion takes the next turn", async () => {
  const lane = new ResourceWorkLane();
  const owner = await lane.acquire("runtime-preparation");
  const order: string[] = [];
  const low = lane.acquire("recording-cleanup").then((lease) => {
    order.push("cleanup");
    lease.release();
  });
  const high = lane.acquire("asr-conversion").then((lease) => {
    order.push("asr");
    lease.release();
  });
  owner.release();
  await Promise.all([low, high]);
  assert.deepEqual(order, ["asr", "cleanup"]);
  owner.release();
  lane.close();
});

test("recording finalization bypasses installation without aborting a partially installed Runtime", async () => {
  const lane = new ResourceWorkLane();
  const installing = await lane.acquire("runtime-preparation");
  const saving = await lane.acquire("recording-export");
  assert.equal(installing.signal.aborted, false);
  installing.release();
  let started = false;
  const next = lane.acquire("asr-conversion").then((lease) => {
    started = true;
    lease.release();
  });
  await Promise.resolve();
  assert.equal(started, false);
  saving.release();
  await next;
  lane.close();
});

test("recording finalization cancels a disposable scan but does not steal its ownership", async () => {
  const lane = new ResourceWorkLane();
  const scanning = await lane.acquire("recording-cleanup");
  const saving = await lane.acquire("recording-export");
  assert.equal(scanning.signal.aborted, true);
  saving.release();
  let started = false;
  const next = lane.acquire("runtime-preparation").then((lease) => {
    started = true;
    lease.release();
  });
  await Promise.resolve();
  assert.equal(started, false);
  scanning.release();
  await next;
  lane.close();
});

test("queued work times out and cancels without releasing an active owner", async () => {
  const lane = new ResourceWorkLane(15);
  const active = await lane.acquire("runtime-preparation");
  await assert.rejects(lane.acquire("asr-conversion"), /background_resource_wait_timeout/);
  const controller = new AbortController();
  const cancelled = lane.acquire("model-verification", controller.signal);
  controller.abort();
  await assert.rejects(cancelled, /ai_task_paused/);
  assert.equal(active.signal.aborted, false);
  active.release();
  const next = await lane.acquire("asr-conversion");
  next.release();
  lane.close();
});

test("close aborts running and queued work and rejects future admission", async () => {
  const lane = new ResourceWorkLane();
  const active = await lane.acquire("runtime-preparation");
  const waiting = lane.acquire("asr-conversion");
  lane.close();
  await assert.rejects(waiting, /ai_task_paused/);
  assert.equal(active.signal.aborted, true);
  await assert.rejects(lane.acquire("recording-export"), /ai_task_paused/);
  active.release();
});

test("execution deadline aborts the owner and holds its lane until cleanup completes", async () => {
  const lane = new ResourceWorkLane(100, 15);
  const active = await lane.acquire("runtime-preparation");
  await new Promise<void>((resolve) =>
    active.signal.addEventListener("abort", () => resolve(), { once: true }),
  );
  let started = false;
  const next = lane.acquire("asr-conversion").then((lease) => {
    started = true;
    lease.release();
  });
  await Promise.resolve();
  assert.equal(started, false);
  active.release();
  await next;
  lane.close();
});

test("Runtime preparation nested in a text inference lease cannot deadlock", async () => {
  const scheduler = new ResourceScheduler(() => 4 * 1024 ** 3, capacity);
  const inference = await scheduler.acquireCompute("summary", true);
  assert.equal(await scheduler.runWork("runtime-preparation", async () => "ready"), "ready");
  inference.release();
  scheduler.close();
});

test("work failures release the CPU lane; extreme memory pressure preserves recording saving", async () => {
  const scheduler = new ResourceScheduler(() => 4 * 1024 ** 3, capacity);
  await assert.rejects(
    scheduler.runWork("runtime-preparation", async () => {
      throw new Error("install-failed");
    }),
    /install-failed/,
  );
  assert.equal(await scheduler.runWork("model-verification", async () => true), true);
  scheduler.close();
  const constrained = new ResourceScheduler(() => 200 * 1024 ** 2, capacity);
  await assert.rejects(
    constrained.runWork("runtime-preparation", async () => true),
    /memory_pressure/,
  );
  assert.equal(await constrained.runWork("recording-export", async () => true), true);
  constrained.close();
});

test("compute waiting has a deadline and shutdown cannot admit late work", async () => {
  const scheduler = new ResourceScheduler(() => 4 * 1024 ** 3, capacity, 15);
  const owner = await scheduler.acquireCompute("transcription", true);
  await assert.rejects(scheduler.acquireCompute("summary", true), /ai_compute_wait_timeout/);
  assert.equal(owner.signal.aborted, false);
  assert.equal(scheduler.getComputeSnapshot().waiting, 0);
  scheduler.close();
  owner.release();
  await assert.rejects(scheduler.acquireCompute("question", true), /ai_task_paused/);
});
