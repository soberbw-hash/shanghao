import assert from "node:assert/strict";
import test from "node:test";

import type { AiAsrModelId, RecordingLibraryItem, VoiceMemoryRecord } from "@private-voice/shared";

import { buildModelComparisonExport } from "../src/renderer/src/features/ai/modelComparisonExport";

const recording: RecordingLibraryItem = {
  id: "recording-1",
  recordingId: "recording-1",
  title: "语音 01",
  fileName: "voice-01.m4a",
  filePath: "C:\\Users\\sober\\Documents\\voice-01.m4a",
  mediaUrl: "file:///voice-01.m4a",
  createdAt: "2026-08-26T00:00:00.000Z",
  modifiedAt: "2026-08-26T00:00:00.000Z",
  fileSize: 128,
  roomId: "main",
  isFavorite: false,
  markers: [],
};

const record = {
  schemaVersion: 1,
  recordingId: "recording-1",
  filePath: recording.filePath,
  roomId: "main",
  roomName: "一号房",
  createdAt: recording.createdAt,
  updatedAt: recording.modifiedAt,
  phase: "ready",
  progress: 100,
  speakers: [
    {
      speakerId: "S01",
      nickname: "测试说话人",
      confidence: "high",
    },
  ],
  transcript: [],
  summary: [],
  chapters: [],
  highlights: [],
  markerTitles: [],
  timeline: [],
  transcriptionVariants: {
    "cohere-transcribe-2b": {
      model: {
        id: "cohere-transcribe-2b",
        name: "Cohere Transcribe 2B",
        version: "rev-test",
      },
      speakers: [
        {
          speakerId: "S01",
          nickname: "测试说话人",
          confidence: "high",
        },
      ],
      transcript: [
        {
          id: "segment-1",
          recordingId: "recording-1",
          startMs: 1_000,
          endMs: 2_500,
          speakerId: "S01",
          confidence: "high",
          text: "这是测试文本。",
          words: [
            { id: "word-1", startMs: 1_000, endMs: 1_500, text: "这是" },
            { id: "word-2", startMs: 1_600, endMs: 2_500, text: "测试文本。" },
          ],
        },
      ],
      transcriptionElapsedMs: 2_000,
      updatedAt: "2026-08-26T00:01:00.000Z",
    },
  },
} as VoiceMemoryRecord;

test("model comparison export keeps per-model raw transcription data without CER", () => {
  const modelIds: AiAsrModelId[] = ["cohere-transcribe-2b", "dolphin-cn-dialect-0.4b"];
  const payload = buildModelComparisonExport({
    recording,
    recordingTitle: "语音 01",
    audioDurationMs: 10_000,
    record,
    modelIds,
    results: {
      "cohere-transcribe-2b": {
        modelId: "cohere-transcribe-2b",
        status: "success",
        elapsedMs: 2_000,
      },
      "dolphin-cn-dialect-0.4b": {
        modelId: "dolphin-cn-dialect-0.4b",
        status: "failed",
        elapsedMs: 0,
        message: "transcription_checkpoint_missing",
      },
    },
  });

  assert.equal(payload.recording.sourceFileName, "voice-01.m4a");
  assert.equal(payload.models.length, 2);
  assert.equal(payload.models[0]?.text, "这是测试文本。");
  assert.equal(payload.models[0]?.elapsedMs, 2_000);
  assert.equal(payload.models[0]?.realTimeFactor, 0.2);
  assert.equal(payload.models[0]?.speakers[0]?.nickname, "测试说话人");
  assert.equal(payload.models[0]?.segments[0]?.speakerName, "测试说话人");
  assert.equal(payload.models[0]?.segments[0]?.words.length, 2);
  assert.equal(payload.models[1]?.status, "failed");
  assert.equal(payload.models[1]?.error, "transcription_checkpoint_missing");
  assert.equal("cer" in payload, false);
});
