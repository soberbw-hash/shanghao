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

const modelId: AiAsrModelId = "qwen3-asr-0.6b-force";

const definitions: TranscriptionUnitDefinition[] = [0, 1, 2].map((index) => ({
  index,
  startMs: index * TRANSCRIPTION_CHUNK_MS,
  endMs: (index + 1) * TRANSCRIPTION_CHUNK_MS,
}));

test("durable transcription units preserve failed gaps and reset interrupted work", () => {
  const initial = createTranscriptionUnits("recording-1", modelId, definitions, undefined, 0);
  const existing = initial.map((candidate, index) => ({
    ...candidate,
    status: ["completed", "failed", "running"][index] as VoiceMemoryTranscriptionUnit["status"],
    attempts: 1,
    retryCount: index === 1 ? 2 : 0,
  }));
  const next = createTranscriptionUnits("recording-1", modelId, definitions, existing, 0);

  assert.deepEqual(
    next.map((candidate) => candidate.status),
    ["completed", "failed", "pending"],
  );
  assert.equal(next[1]?.retryCount, 2);
  assert.equal(next[2]?.attempts, 1);
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
});

test("legacy checkpoint completion is migrated into durable unit state", () => {
  const next = createTranscriptionUnits("recording-1", modelId, definitions, undefined, 2);

  assert.deepEqual(
    next.map((candidate) => candidate.status),
    ["completed", "completed", "pending"],
  );
  assert.equal(next[0]?.coveredAudioMs, TRANSCRIPTION_CHUNK_MS);
});
