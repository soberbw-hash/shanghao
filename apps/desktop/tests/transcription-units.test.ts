import assert from "node:assert/strict";
import test from "node:test";

import type {
  AiAsrModelId,
  VoiceMemoryTranscriptSegment,
  VoiceMemoryTranscriptionUnit,
} from "@private-voice/shared";

import {
  createTranscriptionUnits,
  statsFromTranscriptionUnits,
  TRANSCRIPTION_CHUNK_MS,
  type TranscriptionUnitDefinition,
} from "../src/main/ai-voice-memory-service";
import { durableUnitsMatchDefinitions } from "../src/main/voice-memory-source-plan";
import { describeEmptyTranscription } from "../src/main/voice-memory-empty-result";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { evaluateVoiceMemoryTranscriptionValidity } from "@private-voice/shared";

const modelId: AiAsrModelId = "qwen3-asr-0.6b-force";

const definitions: TranscriptionUnitDefinition[] = [0, 1, 2].map((index) => ({
  index,
  startMs: index * TRANSCRIPTION_CHUNK_MS,
  endMs: (index + 1) * TRANSCRIPTION_CHUNK_MS,
}));

test("same unit count cannot resume a different member or timeline", () => {
  const expected = definitions.map((definition) => ({ ...definition, speakerId: "member-a" }));
  const units = createTranscriptionUnits("recording-1", modelId, expected, undefined, 0);
  assert.equal(durableUnitsMatchDefinitions(expected, units), true);
  assert.equal(
    durableUnitsMatchDefinitions(
      expected,
      units.map((unit, index) => (index === 1 ? { ...unit, speakerId: "member-b" } : unit)),
    ),
    false,
  );
  assert.equal(
    durableUnitsMatchDefinitions(
      expected,
      units.map((unit, index) => (index === 1 ? { ...unit, startMs: unit.startMs + 1 } : unit)),
    ),
    false,
  );
  assert.equal(durableUnitsMatchDefinitions(expected, [...units].reverse()), false);
});

test("durable transcription units preserve failed gaps and reset interrupted work", () => {
  const initial = createTranscriptionUnits("recording-1", modelId, definitions, undefined, 0);
  const existing = initial.map((candidate, index) => ({
    ...candidate,
    status: ["completed", "failed", "running"][index] as VoiceMemoryTranscriptionUnit["status"],
    attempts: 1,
    retryCount: index === 1 ? 2 : 0,
    sourceFingerprint: "a".repeat(64),
  }));
  const next = createTranscriptionUnits("recording-1", modelId, definitions, existing, 0);

  assert.deepEqual(
    next.map((candidate) => candidate.status),
    ["completed", "failed", "pending"],
  );
  assert.equal(next[1]?.retryCount, 2);
  assert.equal(next[2]?.attempts, 1);
  assert.equal(next[0]?.sourceFingerprint, "a".repeat(64));
  assert.equal(next[2]?.sourceFingerprint, "a".repeat(64));
});

test("transcription stats do not report a partial run as complete", () => {
  const initial = createTranscriptionUnits("recording-1", modelId, definitions, undefined, 0);
  const units = initial.map((candidate, index) => ({
    ...candidate,
    status: ["completed", "failed", "pending"][index] as VoiceMemoryTranscriptionUnit["status"],
    attempts: 1,
    retryCount: index === 1 ? 2 : 0,
    processedAudioMs: index === 0 ? TRANSCRIPTION_CHUNK_MS : 0,
    coveredAudioMs: index === 0 ? TRANSCRIPTION_CHUNK_MS : 0,
    segmentCount: index === 0 ? 1 : 0,
  }));
  const transcript: VoiceMemoryTranscriptSegment[] = [
    {
      id: "segment-1",
      recordingId: "recording-1",
      startMs: 100,
      endMs: 1_000,
      speakerId: "S01",
      confidence: "pending",
      text: "测试文本",
    },
  ];
  const stats = statsFromTranscriptionUnits(90_000, units, transcript);

  assert.equal(stats.completedUnits, 1);
  assert.equal(stats.failedUnits, 1);
  assert.equal(stats.coveredAudioMs, TRANSCRIPTION_CHUNK_MS);
  assert.equal(stats.terminationReason, "partial");
  assert.equal(
    stats.speechCoveragePercent,
    undefined,
    "missing audio activity is not 100% coverage",
  );
});

test("legacy checkpoint completion is migrated into durable unit state", () => {
  const next = createTranscriptionUnits("recording-1", modelId, definitions, undefined, 2);

  assert.deepEqual(
    next.map((candidate) => candidate.status),
    ["completed", "completed", "pending"],
  );
  assert.equal(next[0]?.coveredAudioMs, TRANSCRIPTION_CHUNK_MS);
});

test("unexamined member audio remains a review signal after saving progress", () => {
  const [unit] = createTranscriptionUnits("recording-1", modelId, [definitions[0]!], undefined, 0);
  const completed = {
    ...unit!,
    status: "completed" as const,
    processedAudioMs: TRANSCRIPTION_CHUNK_MS,
    coveredAudioMs: TRANSCRIPTION_CHUNK_MS,
  };
  const initial = statsFromTranscriptionUnits(TRANSCRIPTION_CHUNK_MS, [completed], []);
  const saved = statsFromTranscriptionUnits(TRANSCRIPTION_CHUNK_MS, [completed], [], {
    ...initial,
    unexaminedParticipantAudioMs: 1200,
    finalResultSaved: true,
  });
  assert.equal(saved.unexaminedParticipantAudioMs, 1200);
  const validity = evaluateVoiceMemoryTranscriptionValidity(saved, [completed]);
  assert.equal(validity.dataValidity, "valid_with_review");
  assert.ok(validity.reviewReasons.some((reason) => reason.includes("可能包含静音")));
});

test("empty results from quiet audio remain explicitly uncertain after saving", () => {
  const [unit] = createTranscriptionUnits("recording-1", modelId, [definitions[0]!], undefined, 0);
  const completed = {
    ...unit!,
    status: "completed" as const,
    outputStatus: "quiet_audio_uncertain" as const,
    processedAudioMs: TRANSCRIPTION_CHUNK_MS,
    coveredAudioMs: 0,
  };
  const stats = statsFromTranscriptionUnits(TRANSCRIPTION_CHUNK_MS, [completed], []);
  const validity = evaluateVoiceMemoryTranscriptionValidity({ ...stats, finalResultSaved: true }, [
    completed,
  ]);
  assert.equal(validity.dataValidity, "valid_with_review");
  assert.ok(validity.reviewReasons.some((reason) => reason.includes("低音量")));
  const record = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "recording-1", filePath: "fixture.wav" }),
    transcriptionUnits: [completed],
    transcriptionStats: stats,
  };
  assert.equal(describeEmptyTranscription(record, true).code, "quiet_audio_uncertain");
  assert.equal(describeEmptyTranscription(record, false).code, "partial_transcription");
});
