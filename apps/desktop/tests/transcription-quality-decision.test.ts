import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceMemoryTranscriptionUnit } from "@private-voice/shared";
import { decideTranscriptionQuality, reviewTranscriptionUnit } from "@private-voice/shared";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";

const unit = (patch: Partial<VoiceMemoryTranscriptionUnit> = {}): VoiceMemoryTranscriptionUnit => ({
  unitId: "synthetic-unit",
  modelId: "qwen3-asr-0.6b-force",
  index: 0,
  startMs: 10_000,
  endMs: 20_000,
  status: "completed",
  attempts: 1,
  retryCount: 0,
  processedAudioMs: 10_000,
  coveredAudioMs: 10_000,
  segmentCount: 1,
  outputStatus: "normal",
  updatedAt: new Date(0).toISOString(),
  ...patch,
});

test("accepts ordinary output and explicit silence without treating activity as proof of omission", () => {
  assert.equal(decideTranscriptionQuality({ unit: unit() }).action, "accept");
  assert.equal(
    decideTranscriptionQuality({ unit: unit({ outputStatus: "vad_silence" }) }).action,
    "accept",
  );
  const uncertain = decideTranscriptionQuality({
    unit: unit({
      outputStatus: "empty_output_on_speech",
      commonVad: {
        hasSpeech: true,
        speechDurationMs: 3_000,
        silenceDurationMs: 7_000,
        activeFrameRatio: 0.2,
        peak: 0.1,
      },
    }),
  });
  assert.equal(uncertain.action, "retry_candidate");
  assert.equal(uncertain.autoRunAllowed, true);
  assert.deepEqual(uncertain.sourceSpan, { startMs: 10_000, endMs: 20_000 });
});

test("low-level uncertain audio requires listening and is never automatically retried", () => {
  const decision = decideTranscriptionQuality({
    unit: unit({ outputStatus: "quiet_audio_uncertain" }),
  });
  assert.equal(decision.action, "manual_review");
  assert.equal(decision.autoRunAllowed, false);
  assert.deepEqual(decision.reasonCodes, ["quiet_audio_uncertain"]);
});

test("anomalies use only the existing attempt budget and conflicts preserve both sources for review", () => {
  const eligible = decideTranscriptionQuality({
    unit: unit({ outputStatus: "repetition_loop", anomalyTypes: ["repetition_loop"], attempts: 2 }),
  });
  assert.equal(eligible.action, "retry_candidate");
  assert.equal(eligible.retriesRemaining, 1);

  const exhausted = decideTranscriptionQuality({
    unit: unit({ outputStatus: "abnormal_output", attempts: 3 }),
  });
  assert.equal(exhausted.action, "manual_review");
  assert.equal(exhausted.autoRunAllowed, false);
  assert.ok(exhausted.reasonCodes.includes("retry_budget_exhausted"));

  const conflict = decideTranscriptionQuality({ unit: unit(), sourceConflict: true });
  assert.equal(conflict.action, "manual_review");
  assert.equal(conflict.autoRunAllowed, false);
  assert.ok(conflict.reasonCodes.includes("transcript_sources_conflict"));
});

test("pending units remain incomplete and source/timeline uncertainty never triggers retries", () => {
  assert.equal(
    decideTranscriptionQuality({ unit: unit({ status: "pending" }) }).action,
    "incomplete",
  );
  const decision = decideTranscriptionQuality({
    unit: unit(),
    sourceIdentityKnown: false,
    alignmentValid: false,
  });
  assert.equal(decision.action, "manual_review");
  assert.equal(decision.autoRunAllowed, false);
  assert.deepEqual(decision.reasonCodes, ["source_identity_unknown", "timeline_invalid"]);
});

test("completed markers with unverified coverage cannot claim acceptance", () => {
  const decision = decideTranscriptionQuality({ unit: unit({ coveredAudioMs: 1_000 }) });
  assert.equal(decision.action, "incomplete");
  assert.deepEqual(decision.reasonCodes, ["unit_coverage_gap"]);
  assert.equal(decision.autoRunAllowed, false);
});

test("record review uses known speaker identity and overlapping source conflicts", () => {
  const record = createEmptyVoiceMemoryRecord({
    recordingId: "synthetic",
    filePath: "synthetic.wav",
  });
  const source = unit({ speakerId: "a" });
  assert.equal(reviewTranscriptionUnit(record, source).action, "manual_review");
  record.speakers = [{ speakerId: "a", confidence: "high" }];
  assert.equal(reviewTranscriptionUnit(record, source).action, "accept");
  record.transcriptionFusion = {
    status: "completed",
    sourceSignature: "synthetic",
    completedBatches: 1,
    totalBatches: 1,
    speakers: record.speakers,
    transcript: [
      {
        id: "one",
        recordingId: "synthetic",
        speakerId: "a",
        confidence: "high",
        startMs: 12_000,
        endMs: 13_000,
        text: "两份原稿有分歧",
        fusionUncertain: true,
      },
    ],
  };
  const decision = reviewTranscriptionUnit(record, source);
  assert.ok(decision.reasonCodes.includes("transcript_sources_conflict"));
  assert.equal(decision.autoRunAllowed, false);
  assert.equal(
    reviewTranscriptionUnit(record, unit({ speakerId: "a", startMs: 30000, endMs: 40000 })).action,
    "accept",
  );
});
