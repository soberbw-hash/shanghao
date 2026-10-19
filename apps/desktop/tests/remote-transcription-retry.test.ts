import assert from "node:assert/strict";
import test from "node:test";
import { transcribeRemoteWithRetry } from "../src/main/remote-transcription-retry";
import { transcriptionProviderError } from "../src/renderer/src/features/ai/transcriptionProviderError";

test("transient cloud server failure retries the current part with a fixed attempt limit", async () => {
  let attempts = 0;
  const result = await transcribeRemoteWithRetry(async () => {
    attempts++;
    if (attempts < 2) throw new Error("cloud_asr_http_500");
    return "fixture transcript";
  }, new AbortController().signal);
  assert.equal(result, "fixture transcript");
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(
    transcribeRemoteWithRetry(async () => {
      attempts++;
      throw new Error("cloud_asr_http_503");
    }, new AbortController().signal),
    /http_503/,
  );
  assert.equal(attempts, 3);
  assert.match(transcriptionProviderError("cloud_asr_http_500")!, /服务.*暂时|稍后/);
});

test("billing/auth errors do not retry and cancellation interrupts transient retry waits", async () => {
  for (const status of [400, 401, 402, 403, 422]) {
    let attempts = 0;
    await assert.rejects(
      transcribeRemoteWithRetry(async () => {
        attempts++;
        throw new Error(`cloud_asr_http_${status}`);
      }, new AbortController().signal),
      new RegExp(`http_${status}`),
    );
    assert.equal(attempts, 1);
  }
  const controller = new AbortController();
  let attempts = 0;
  const result = transcribeRemoteWithRetry(async () => {
    attempts++;
    queueMicrotask(() => controller.abort());
    throw new Error("cloud_asr_http_500");
  }, controller.signal);
  await assert.rejects(result, /ai_task_paused/);
  assert.equal(attempts, 1);
});
