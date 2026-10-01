import assert from "node:assert/strict";
import test from "node:test";

import type { AiModelId } from "@private-voice/shared";

import { AiRuntimeManager, type TranscriptionChunkOptions } from "../src/main/ai-runtime-manager";
import { ResourceScheduler } from "../src/main/resource-scheduler";

test("FFmpeg preparation and inference share one owned compute lease", async () => {
  const scheduler = new ResourceScheduler();
  const manager = new AiRuntimeManager(
    "C:\\test-runtime",
    { model: () => undefined, qwen: () => undefined, activeAsr: () => "glm-asr-nano-2512" },
    {
      acquireComputeSlot: (kind, manual, signal) => scheduler.acquireCompute(kind, manual, signal),
    },
  );
  const internal = manager as unknown as {
    transcribeChunkOnce: (options: TranscriptionChunkOptions) => Promise<never>;
  };
  let started = false;
  internal.transcribeChunkOnce = async (options) => {
    started = true;
    assert.equal(scheduler.getComputeSnapshot().activeKind, "transcription");
    assert.equal(options.signal?.aborted, false);
    throw new Error("fixture_preparation_failed");
  };
  await assert.rejects(
    manager.transcribeChunk({
      recordingId: "fixture",
      filePath: "unused",
      offsetMs: 0,
      durationMs: 1000,
      resourceMode: "normal",
      manual: true,
    }),
    /fixture_preparation_failed/,
  );
  assert.equal(started, true);
  assert.equal(scheduler.getComputeSnapshot().activeKind, undefined);
  const text = await scheduler.acquireCompute("summary", true);
  const controller = new AbortController();
  started = false;
  const waiting = manager.transcribeChunk({
    recordingId: "fixture",
    filePath: "unused",
    offsetMs: 0,
    durationMs: 1000,
    resourceMode: "normal",
    manual: true,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(waiting, /ai_task_paused/);
  assert.equal(started, false, "cancelled queued work must not start FFmpeg");
  assert.equal(scheduler.getComputeSnapshot().activeKind, "summary");
  text.release();
});

test("shared AI Runtime preparation is serialized across model completions", async () => {
  const manager = new AiRuntimeManager("C:\\test-runtime", {
    model: () => undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const internal = manager as unknown as {
    prepareModelRuntimeOnce: (id: AiModelId) => Promise<{ ready: boolean; message?: string }>;
  };
  let active = 0;
  let maximumActive = 0;
  const order: string[] = [];
  internal.prepareModelRuntimeOnce = async (id) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`start:${id}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`end:${id}`);
    active -= 1;
    return { ready: true };
  };

  await Promise.all([
    manager.prepareModelRuntime("qwen3-asr-1.7b-force"),
    manager.prepareModelRuntime("qwen3-asr-0.6b-force"),
    manager.prepareModelRuntime("fun-asr-nano-2512"),
  ]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [
    "start:qwen3-asr-1.7b-force",
    "end:qwen3-asr-1.7b-force",
    "start:qwen3-asr-0.6b-force",
    "end:qwen3-asr-0.6b-force",
    "start:fun-asr-nano-2512",
    "end:fun-asr-nano-2512",
  ]);
});

test("cancelled runtime preparation does not start after waiting in the queue", async () => {
  const manager = new AiRuntimeManager("C:\\test-runtime", {
    model: () => undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const internal = manager as unknown as {
    prepareModelRuntimeOnce: (id: AiModelId, signal?: AbortSignal) => Promise<{ ready: boolean }>;
  };
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const started: AiModelId[] = [];
  internal.prepareModelRuntimeOnce = async (id) => {
    started.push(id);
    if (started.length === 1) await firstGate;
    return { ready: true };
  };

  const first = manager.prepareModelRuntime("qwen3-asr-1.7b-force");
  const controller = new AbortController();
  const waiting = manager.prepareModelRuntime("fun-asr-nano-2512", controller.signal);
  controller.abort();
  await assert.rejects(waiting, /ai_task_paused/);
  assert.equal(started.includes("fun-asr-nano-2512"), false);
  releaseFirst();

  await first;
  assert.deepEqual(started, ["qwen3-asr-1.7b-force"]);
});

test("runtime preparation forwards the active cancellation signal", async () => {
  const manager = new AiRuntimeManager("C:\\test-runtime", {
    model: () => undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const internal = manager as unknown as {
    prepareModelRuntimeOnce: (id: AiModelId, signal?: AbortSignal) => Promise<{ ready: boolean }>;
  };
  let started!: () => void;
  const operationStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  internal.prepareModelRuntimeOnce = async (_id, signal) => {
    started();
    await new Promise<void>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("ai_task_paused")), {
        once: true,
      });
    });
    return { ready: true };
  };

  const controller = new AbortController();
  const preparing = manager.prepareModelRuntime("fun-asr-nano-2512", controller.signal);
  await operationStarted;
  controller.abort();
  await assert.rejects(preparing, /ai_task_paused/);
});

test("automatic and requested CUDA preparation cannot install into one target together", async () => {
  const manager = new AiRuntimeManager("C:\\test-runtime", {
    model: () => undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const internal = manager as unknown as {
    ensureCudaRuntime: (signal?: AbortSignal) => Promise<void>;
    ensureCudaRuntimeOnce: (signal?: AbortSignal) => Promise<void>;
  };
  let active = 0;
  let maximumActive = 0;
  let attempts = 0;
  internal.ensureCudaRuntimeOnce = async () => {
    attempts += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  };
  const cancelled = new AbortController();
  const first = internal.ensureCudaRuntime();
  const second = internal.ensureCudaRuntime();
  const third = internal.ensureCudaRuntime(cancelled.signal);
  cancelled.abort();
  await Promise.all([first, second]);
  await assert.rejects(third, /ai_task_paused/);
  assert.equal(maximumActive, 1);
  assert.equal(attempts, 2);
});

test("failed CUDA initialization can be retried after the environment recovers", async () => {
  const manager = new AiRuntimeManager("C:\\test-runtime", {
    model: () => undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const internal = manager as unknown as {
    initializeCudaRuntimeOnce: () => Promise<{ cudaAvailable: boolean }>;
  };
  let attempts = 0;
  internal.initializeCudaRuntimeOnce = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary cuda failure");
    return { cudaAvailable: true };
  };
  await assert.rejects(manager.initializeCudaRuntime(), /temporary cuda failure/);
  assert.equal((await manager.initializeCudaRuntime()).cudaAvailable, true);
  assert.equal(attempts, 2);
});
