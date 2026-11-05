import assert from "node:assert/strict";
import test from "node:test";
import { AiRuntimeManager } from "../src/main/ai-runtime-manager";
import type { AsrWorkerResult } from "../src/main/asr-persistent-worker";
import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";
import { mergeTranscriptIntoSentences } from "@private-voice/shared";

const normalize = (result: AsrWorkerResult): VoiceMemoryTranscriptSegment[] => {
  const method = (
    AiRuntimeManager.prototype as unknown as {
      normalizePythonAsrResult: (
        result: AsrWorkerResult,
        model: "qwen3-asr-0.6b-force",
        recording: string,
        offset: number,
        duration: number,
      ) => VoiceMemoryTranscriptSegment[];
    }
  ).normalizePythonAsrResult;
  return method.call(AiRuntimeManager.prototype, result, "qwen3-asr-0.6b-force", "r", 5000, 1000);
};

test("invalid alignment keeps the complete original text and marks only the real chunk range", () => {
  const result = normalize({
    text: "大家一起走。",
    segments: [
      { text: "大家", startMs: 10, endMs: 20 },
      { text: "一起走", startMs: 20, endMs: 1200 },
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.text, "大家一起走。");
  assert.equal(result[0]?.timestampPrecision, "chunk");
  assert.deepEqual([result[0]?.startMs, result[0]?.endMs], [5000, 6000]);
});

test("valid short alignment is not artificially extended", () => {
  const result = normalize({ text: "好。", segments: [{ text: "好", startMs: 100, endMs: 125 }] });
  assert.deepEqual([result[0]?.startMs, result[0]?.endMs], [5100, 5125]);
  assert.equal(result[0]?.timestampPrecision, undefined);
});

test("incomplete alignment never drops unaligned recognised words", () => {
  const result = normalize({
    text: "大家一起走。",
    segments: [{ text: "大家", startMs: 10, endMs: 20 }],
  });
  assert.equal(result[0]?.text, "大家一起走。");
  assert.equal(result[0]?.timestampPrecision, "chunk");
});

test("merging a coarse chunk with aligned text keeps the coarse timing warning", () => {
  const segment = {
    id: "1",
    recordingId: "r",
    speakerId: "s",
    confidence: "pending" as const,
    text: "大家",
    startMs: 0,
    endMs: 100,
  };
  const merged = mergeTranscriptIntoSentences([
    segment,
    { ...segment, id: "2", text: "走", startMs: 100, endMs: 200, timestampPrecision: "chunk" },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.timestampPrecision, "chunk");
});
