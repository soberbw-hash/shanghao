import assert from "node:assert/strict";
import test from "node:test";
import { waitForTask } from "../src/main/task-cancellation";
import { transcribeChunkWithRetry } from "../src/main/voice-memory-transcription-retry";
import type { TranscriptionChunkRuntimeResult } from "../src/main/asr-benchmark-runtime";

const context = { recordingId: "isolated", unit: 1, totalUnits: 1 };
const success = (): TranscriptionChunkRuntimeResult => ({
  segments: [],
  rawText: "",
  outputStatus: "normal",
  anomalyTypes: [],
  anomalyReasons: [],
  commonVad: {} as TranscriptionChunkRuntimeResult["commonVad"],
  timing: { conversionTimeMs: 0, totalTimeMs: 0 },
});

test("retry wait cancels promptly without starting another worker", async () => {
  const controller = new AbortController();
  let calls = 0;
  const operation = transcribeChunkWithRetry(
    async () => {
      calls++;
      queueMicrotask(() => controller.abort());
      throw new Error("temporary failure");
    },
    controller.signal,
    context,
    () => undefined,
  );
  await assert.rejects(operation, /ai_task_paused|temporary failure/);
  assert.equal(calls, 1);
});

test("late worker success cannot be committed after cancellation", async () => {
  const controller = new AbortController();
  await assert.rejects(
    transcribeChunkWithRetry(
      async () => {
        controller.abort();
        return success();
      },
      controller.signal,
      context,
      () => undefined,
    ),
    /ai_task_paused/,
  );
});

test("deterministic runtime error stops without retrying", async () => {
  let calls = 0;
  const result = await transcribeChunkWithRetry(
    async () => {
      calls++;
      throw new Error("DLL load failed");
    },
    new AbortController().signal,
    context,
    () => undefined,
  );
  assert.equal(result.fatal, true);
  assert.equal(calls, 1);
  assert.equal(result.attemptHistory.length, 1);
});

test("repeated anomalous output remains diagnostic and never final text", async () => {
  let calls = 0;
  const result = await transcribeChunkWithRetry(
    async () => {
      calls++;
      return {
        ...success(),
        outputStatus: "repetition_loop",
        anomalyTypes: ["repetition_loop"],
        anomalyReasons: ["repeated"],
        rawText: "raw",
      };
    },
    new AbortController().signal,
    context,
    () => undefined,
  );
  assert.equal(calls, 2);
  assert.equal(result.failed, true);
  assert.deepEqual(result.segments, []);
  assert.equal(result.result?.rawAnomalyAttempts?.length, 2);
});

test("shared wait supports already cancelled and mid-wait cancellation", async () => {
  const controller = new AbortController();
  const pending = waitForTask(60_000, controller.signal);
  controller.abort();
  await assert.rejects(pending, /ai_task_paused/);
  await assert.rejects(waitForTask(1, controller.signal), /ai_task_paused/);
  await waitForTask(1);
});
