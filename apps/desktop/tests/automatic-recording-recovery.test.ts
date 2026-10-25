import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import {
  canResumeRemoteTranscription,
  planAutomaticRecordingRecovery,
} from "../src/main/automatic-recording-recovery";

test("only transient ASR failures get bounded durable recovery", () => {
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
      false,
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
    false,
    "persisted new policy cannot bypass the retry ceiling again",
  );
});
