import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import {
  automaticCloudFailure,
  canResumeRemoteTranscription,
  planAutomaticRecordingRecovery,
  retryDeferredRecordings,
} from "../src/main/automatic-recording-recovery";

test("temporary text provider failures enter recovery while billing and credential failures do not", () => {
  const record = createEmptyVoiceMemoryRecord({ recordingId: "text", filePath: "synthetic.wav" });
  for (const reason of [
    "cloud_ai_timeout",
    "custom_ai_network_error",
    "custom_ai_http_503",
    "custom_ai_http_429",
  ]) {
    const normalized = automaticCloudFailure(reason);
    assert.equal(
      planAutomaticRecordingRecovery(record, normalized, { enabled: true, paused: false }).deferred,
      true,
    );
  }
  for (const reason of ["custom_ai_http_401", "custom_ai_http_402", "custom_ai_invalid_json"]) {
    const normalized = automaticCloudFailure(reason);
    assert.equal(normalized, reason);
    assert.equal(
      planAutomaticRecordingRecovery(record, normalized, { enabled: true, paused: false }).deferred,
      false,
    );
  }
});

test("unavailable local model does not block cloud summary retry after transcription", async () => {
  const base = createEmptyVoiceMemoryRecord({ recordingId: "r", filePath: "synthetic.wav" });
  const done = {
    ...base,
    transcript: [
      { id: "s", recordingId: "r", speakerId: "speaker", startMs: 0, endMs: 1000, text: "你好" },
    ],
    phase: "paused" as const,
    errorMessage: "deferred:cloud_asr_http_500",
    processingStage: "organize" as const,
    transcriptionElapsedMs: 1000,
    transcriptionModel: { id: "siliconflow-sensevoice-small" as const, name: "cloud" },
    remoteTranscriptionRetry: { attempts: 1, nextAttemptAt: 0 },
  };
  const pending = {
    ...base,
    recordingId: "pending",
    phase: "paused" as const,
    errorMessage: "deferred:cloud_asr_http_500",
    remoteTranscriptionRetry: { attempts: 1, nextAttemptAt: 0 },
  };
  const retried: string[] = [];
  await retryDeferredRecordings(
    true,
    false,
    true,
    async () => [pending, done],
    async (record) => {
      retried.push(record.recordingId);
    },
    () => {},
  );
  assert.deepEqual(retried, ["r"]);
});

test("only transient failures get durable recovery with a capped retry cadence", () => {
  const record = createEmptyVoiceMemoryRecord({ recordingId: "r", filePath: "synthetic.wav" });
  const options = { enabled: true, paused: false, now: 1000 };
  for (const reason of [
    "cloud_asr_http_500",
    "custom_asr_http_429",
    "cloud_asr_network_error",
    "custom_asr_timeout",
  ]) {
    const first = planAutomaticRecordingRecovery(record, reason, options);
    assert.deepEqual(first, { deferred: true, retry: { attempts: 1, nextAttemptAt: 16000 } });
    const second = planAutomaticRecordingRecovery(
      { ...record, remoteTranscriptionRetry: first.retry },
      reason,
      options,
    );
    assert.deepEqual(second, { deferred: true, retry: { attempts: 2, nextAttemptAt: 46000 } });
    assert.equal(
      planAutomaticRecordingRecovery(
        { ...record, remoteTranscriptionRetry: second.retry },
        reason,
        options,
      ).deferred,
      true,
    );
    assert.equal(
      planAutomaticRecordingRecovery(record, reason, { ...options, paused: true }).deferred,
      false,
    );
    assert.equal(
      planAutomaticRecordingRecovery(record, reason, { ...options, enabled: false }).deferred,
      false,
    );
  }
  for (const reason of [
    "cloud_asr_http_400",
    "cloud_asr_http_401",
    "cloud_asr_http_402",
    "custom_asr_http_403",
    "custom_asr_http_422",
    "custom_ai_invalid_json",
  ]) {
    assert.equal(planAutomaticRecordingRecovery(record, reason, options).deferred, false);
  }
  const pending = {
    ...record,
    phase: "paused" as const,
    errorMessage: "deferred:cloud_asr_http_500",
    remoteTranscriptionRetry: { attempts: 1, nextAttemptAt: 16000 },
  };
  assert.equal(canResumeRemoteTranscription(pending, 15999), false);
  assert.equal(canResumeRemoteTranscription(pending, 16000), true);
  assert.equal(canResumeRemoteTranscription({ ...pending, errorMessage: undefined }, 17000), false);
  const legacy = {
    ...record,
    phase: "error" as const,
    errorMessage: "cloud_asr_http_500",
    remoteTranscriptionRetry: { attempts: 2 },
    transcriptionModel: { id: "siliconflow-sensevoice-small" as const, name: "cloud" },
  };
  assert.equal(
    canResumeRemoteTranscription(legacy),
    true,
    "legacy long-upload failure can upgrade once",
  );
  assert.equal(
    canResumeRemoteTranscription({
      ...legacy,
      remoteTranscription: {
        modelId: "siliconflow-sensevoice-small",
        audioDurationMs: 1000,
        parts: [],
        partMs: 30000,
      },
    }),
    true,
    "due transient failures remain recoverable after the first two rounds",
  );
});

test("unconfigured built-in transcription remains deferred without spending network retries", () => {
  const record = createEmptyVoiceMemoryRecord({
    recordingId: "built-in",
    filePath: "synthetic.wav",
  });
  const result = planAutomaticRecordingRecovery(record, "cloud_asr_not_configured", {
    enabled: true,
    paused: false,
  });
  assert.equal(result.deferred, true);
  assert.equal(result.retry, undefined);
});

test("unexpected deferred worker rejection schedules another recovery attempt", async () => {
  const record = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "retry", filePath: "synthetic.wav" }),
    phase: "paused" as const,
    errorMessage: "deferred:cloud_asr_http_500",
    remoteTranscriptionRetry: { attempts: 1, nextAttemptAt: 0 },
  };
  let scheduled = 0;
  await retryDeferredRecordings(
    true,
    false,
    false,
    async () => [record],
    async () => {
      throw new Error("worker_unavailable");
    },
    () => {
      scheduled++;
    },
  );
  assert.equal(scheduled, 1);
});

test("temporarily unavailable local transcription schedules a later check", async () => {
  const record = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "local", filePath: "synthetic.wav" }),
    phase: "paused" as const,
    errorMessage: "deferred:realtime_pressure",
  };
  let scheduled = 0;
  let started = 0;
  await retryDeferredRecordings(
    true,
    false,
    true,
    async () => [record],
    async () => {
      started++;
    },
    () => {
      scheduled++;
    },
  );
  assert.equal(started, 0);
  assert.equal(scheduled, 1);
});
