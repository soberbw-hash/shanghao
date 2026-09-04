import assert from "node:assert/strict";
import test from "node:test";

import type { AiAsrModelId, RecordingLibraryItem, VoiceMemoryRecord } from "@private-voice/shared";

import {
  buildModelComparisonExport,
  buildModelComparisonSummaryExport,
} from "../src/renderer/src/features/ai/modelComparisonExport";

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
      transcriptionStats: {
        audioDurationMs: 10_000,
        processedAudioMs: 10_000,
        coveredAudioMs: 10_000,
        totalUnits: 1,
        completedUnits: 1,
        pendingUnits: 0,
        runningUnits: 0,
        failedUnits: 0,
        retryCount: 0,
        segmentCount: 1,
        speakerCount: 1,
        finalResultSaved: true,
        terminationReason: "completed",
      },
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
  assert.equal(payload.models[0]?.speakerShares[0]?.speakerName, "测试说话人");
  assert.equal(payload.models[0]?.speakerShares[0]?.speakingSharePercent, 100);
  assert.equal(payload.models[1]?.status, "failed");
  assert.equal(payload.models[1]?.error, "transcription_checkpoint_missing");
  assert.equal("cer" in payload, false);
  const summary = buildModelComparisonSummaryExport(payload);
  assert.equal(JSON.stringify(summary).includes("rawRuntimeOutput"), false);
  assert.equal(summary.modelSummary[0]?.status, "success");
});

test("model comparison export never reports interrupted variants as completed", () => {
  const audioDurationMs = 2_474_350;
  const incompleteRecord = {
    ...record,
    transcriptionVariants: {
      ...record.transcriptionVariants,
      "fireredasr2-aed": {
        model: {
          id: "fireredasr2-aed",
          name: "FireRedASR2-AED",
          version: "rev-test",
        },
        speakers: record.speakers,
        transcript: record.transcriptionVariants?.["cohere-transcribe-2b"]?.transcript ?? [],
        transcriptionElapsedMs: 128_100,
        transcriptionStats: {
          audioDurationMs,
          processedAudioMs: 1_950_000,
          coveredAudioMs: 1_950_000,
          totalUnits: 83,
          completedUnits: 65,
          failedUnits: 0,
          retryCount: 0,
          segmentCount: 65,
          speakerCount: 1,
          terminationReason: "paused",
        },
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
      "paraformer-zh": {
        model: {
          id: "paraformer-zh",
          name: "Paraformer-zh + FSMN-VAD + CT-punc",
          version: "rev-test",
        },
        speakers: [],
        transcript: [],
        transcriptionElapsedMs: 232_200,
        transcriptionStats: {
          audioDurationMs,
          processedAudioMs: 0,
          coveredAudioMs: 0,
          totalUnits: 83,
          completedUnits: 0,
          failedUnits: 0,
          retryCount: 0,
          segmentCount: 0,
          speakerCount: 0,
          terminationReason: "paused",
        },
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
    },
  } as VoiceMemoryRecord;
  const payload = buildModelComparisonExport({
    recording,
    recordingTitle: "语音 02",
    audioDurationMs,
    record: incompleteRecord,
    modelIds: ["fireredasr2-aed", "paraformer-zh"],
    results: {
      "fireredasr2-aed": {
        modelId: "fireredasr2-aed",
        status: "success",
        phase: "success",
        elapsedMs: 128_100,
        processedAudioMs: 1_950_000,
        coveredAudioMs: 1_950_000,
        completedUnits: 65,
        totalUnits: 83,
        failedUnits: 0,
      },
      "paraformer-zh": {
        modelId: "paraformer-zh",
        status: "success",
        phase: "success",
        elapsedMs: 232_200,
        processedAudioMs: 0,
        coveredAudioMs: 0,
        completedUnits: 0,
        totalUnits: 83,
        failedUnits: 0,
      },
    },
  });

  const fireRed = payload.models[0];
  const paraformer = payload.models[1];
  assert.equal(fireRed?.status, "paused");
  assert.equal(fireRed?.elapsedMs, undefined);
  assert.equal(fireRed?.attemptElapsedMs, 128_100);
  assert.equal(Math.round(fireRed?.completionPercent ?? 0), 78);
  assert.equal(fireRed?.error, "transcription_incomplete");
  assert.equal(paraformer?.status, "not_started");
  assert.equal(paraformer?.completionPercent, 0);
  assert.equal(paraformer?.elapsedMs, undefined);
  assert.equal(paraformer?.attemptElapsedMs, 232_200);
});
