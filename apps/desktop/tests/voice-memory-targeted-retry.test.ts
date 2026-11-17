import assert from "node:assert/strict";
import test from "node:test";
import type { VoiceMemoryTranscriptionUnit } from "@private-voice/shared";
import { prepareTargetedTranscriptionRetry } from "../src/main/voice-memory-targeted-retry";

const unit = (
  overrides: Partial<VoiceMemoryTranscriptionUnit> = {},
): VoiceMemoryTranscriptionUnit => ({
  unitId: "recording:qwen:0",
  modelId: "qwen3-asr-0.6b",
  pipelineVersion: 1,
  index: 0,
  startMs: 0,
  endMs: 5_000,
  status: "completed",
  attempts: 1,
  retryCount: 0,
  processedAudioMs: 5_000,
  coveredAudioMs: 5_000,
  segmentCount: 2,
  updatedAt: new Date(0).toISOString(),
  ...overrides,
});

test("targeted retry reopens only selected unit and retains its historical attempts", () => {
  const first = unit();
  const other = unit({ unitId: "recording:qwen:1", index: 1, startMs: 5_000, endMs: 10_000 });
  const result = prepareTargetedTranscriptionRetry([first, other], [first.unitId]);
  assert.equal(result.units[0]?.status, "pending");
  assert.equal(result.units[0]?.attempts, 1);
  assert.equal(result.units[0]?.coveredAudioMs, 0);
  assert.equal(result.units[1]?.status, "completed");
  assert.deepEqual([...result.retryIds], [first.unitId]);
});

test("targeted retry rejects missing, active, duplicate and exhausted units", () => {
  assert.throws(() => prepareTargetedTranscriptionRetry([], ["missing"]), /unit_unavailable/);
  assert.throws(
    () => prepareTargetedTranscriptionRetry([unit({ status: "running" })], [unit().unitId]),
    /unit_unavailable/,
  );
  assert.throws(
    () => prepareTargetedTranscriptionRetry([unit()], [unit().unitId, unit().unitId]),
    /selection_invalid/,
  );
  assert.throws(
    () => prepareTargetedTranscriptionRetry([unit({ attempts: 3 })], [unit().unitId]),
    /budget_exhausted/,
  );
});
