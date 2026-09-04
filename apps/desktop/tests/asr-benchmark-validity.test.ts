import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeTranscriptAnomalies,
  evaluateVoiceMemoryTranscriptionValidity,
  type AiAsrModelId,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptionStats,
  type VoiceMemoryTranscriptionUnit,
} from "@private-voice/shared";

import {
  benchmarkDurationForMode,
  benchmarkRangeForMode,
  isFatalTranscriptionRuntimeFailure,
  resolveTranscriptionRunRange,
  statsFromTranscriptionUnits,
} from "../src/main/ai-voice-memory-service";
import { analyzeModelComparison } from "../src/renderer/src/features/ai/modelComparisonAnalysis";
import {
  DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE,
  isSelectableModelComparisonModel,
  isSupportedModelComparisonStorageVersion,
} from "../src/renderer/src/features/ai/modelComparisonQueue";

const comparisonModelStatus = (
  overrides: Partial<import("@private-voice/shared").AiModelStatus> = {},
): import("@private-voice/shared").AiModelStatus => ({
  id: "dolphin-cn-dialect-0.4b",
  category: "asr",
  name: "Dolphin",
  purpose: "test",
  repository: "test/repository",
  approximateBytes: 1,
  phase: "installed",
  userInstalled: true,
  activeRevision: "revision",
  downloadedBytes: 1,
  totalBytes: 1,
  progress: 1,
  updateInProgress: false,
  runtimeReady: false,
  ...overrides,
});

test("installed ASR models remain selectable before lazy runtime preparation", () => {
  assert.equal(isSelectableModelComparisonModel(comparisonModelStatus()), true);
  assert.equal(
    isSelectableModelComparisonModel(comparisonModelStatus({ activeRevision: undefined })),
    false,
  );
  assert.equal(
    isSelectableModelComparisonModel(comparisonModelStatus({ category: "organizer" })),
    false,
  );
});

test("model comparison persistence accepts the current version during restart recovery", () => {
  assert.equal(isSupportedModelComparisonStorageVersion(1), true);
  assert.equal(isSupportedModelComparisonStorageVersion(2), true);
  assert.equal(isSupportedModelComparisonStorageVersion(3), true);
  assert.equal(isSupportedModelComparisonStorageVersion(4), true);
  assert.equal(isSupportedModelComparisonStorageVersion(5), true);
  assert.equal(isSupportedModelComparisonStorageVersion(6), false);
});

const completeStats = (overrides: Partial<VoiceMemoryTranscriptionStats> = {}) => ({
  audioDurationMs: 60_000,
  processedAudioMs: 60_000,
  coveredAudioMs: 60_000,
  totalUnits: 2,
  completedUnits: 2,
  pendingUnits: 0,
  runningUnits: 0,
  failedUnits: 0,
  retryCount: 0,
  segmentCount: 2,
  speakerCount: 1,
  finalResultSaved: true,
  terminationReason: "completed" as const,
  ...overrides,
});

test("benchmark modes cap only benchmark work to their declared duration", () => {
  const sourceDurationMs = 41 * 60_000;
  assert.equal(benchmarkDurationForMode("smoke", sourceDurationMs), 3 * 60_000);
  assert.equal(benchmarkDurationForMode("standard", sourceDurationMs), 10 * 60_000);
  assert.equal(benchmarkDurationForMode("long", sourceDurationMs), sourceDurationMs);
  assert.equal(benchmarkDurationForMode(undefined, sourceDurationMs), sourceDurationMs);
  assert.deepEqual(benchmarkRangeForMode("standard", sourceDurationMs), {
    sourceStartMs: 930_000,
    sourceEndMs: 1_530_000,
    clipDurationMs: 600_000,
  });
  assert.deepEqual(resolveTranscriptionRunRange(sourceDurationMs, undefined), {
    sourceStartMs: 0,
    sourceEndMs: sourceDurationMs,
    clipDurationMs: sourceDurationMs,
  });
  assert.deepEqual(
    resolveTranscriptionRunRange(sourceDurationMs, {
      mode: "standard",
      clips: [
        {
          startMs: 0,
          endMs: 600_000,
          sourceStartMs: 1_000_000,
          sourceEndMs: 1_600_000,
        },
      ],
    }),
    { sourceStartMs: 1_000_000, sourceEndMs: 1_600_000, clipDurationMs: 600_000 },
  );
});

test("speech-only benchmark completion is distinct from speech ratio", () => {
  const validity = evaluateVoiceMemoryTranscriptionValidity(
    completeStats({
      audioDurationMs: 600_000,
      processedAudioMs: 285_681,
      coveredAudioMs: 280_000,
      scheduledSpeechMs: 285_681,
      taskProgressPercent: 100,
      processedSpeechPercent: 100,
      speechRatioPercent: 47.6135,
    }),
  );
  assert.equal(validity.complete, true);
});

test("ARK illegal-instruction worker exits are deterministic fatal runtime failures", () => {
  assert.equal(isFatalTranscriptionRuntimeFailure(new Error("Windows Error 0xc000001d")), true);
  assert.equal(
    isFatalTranscriptionRuntimeFailure(
      new Error("Unable to compare versions for packaging>=20.0: found=None"),
    ),
    true,
  );
  assert.equal(
    isFatalTranscriptionRuntimeFailure(new Error("ModuleNotFoundError: No module named 'foo'")),
    true,
  );
  assert.equal(isFatalTranscriptionRuntimeFailure(new Error("asr_worker_timeout")), false);
});

test("model comparison defaults to the full recording", () => {
  assert.equal(DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE, "long");
});

test("benchmark success requires every planned unit and a durable terminal save", () => {
  const halfway = evaluateVoiceMemoryTranscriptionValidity(
    completeStats({
      processedAudioMs: 30_000,
      coveredAudioMs: 30_000,
      completedUnits: 1,
      pendingUnits: 1,
      terminationReason: "paused",
    }),
  );
  assert.equal(halfway.status, "paused");
  assert.equal(halfway.complete, false);
  assert.equal(halfway.eligibleForQualityRanking, false);
  assert.equal(halfway.eligibleForSpeedRanking, "partial_reference");

  const neverStarted = evaluateVoiceMemoryTranscriptionValidity(
    completeStats({
      processedAudioMs: 0,
      coveredAudioMs: 0,
      completedUnits: 0,
      pendingUnits: 2,
      finalResultSaved: false,
      terminationReason: undefined,
    }),
  );
  assert.equal(neverStarted.status, "not_started");
  assert.equal(neverStarted.dataValidity, "invalid_not_started");
});

test("segment shape and diarization count do not affect benchmark ranking eligibility", () => {
  const compact = evaluateVoiceMemoryTranscriptionValidity(
    completeStats({ segmentCount: 1, speakerCount: 1 }),
  );
  const fragmented = evaluateVoiceMemoryTranscriptionValidity(
    completeStats({ segmentCount: 240, speakerCount: 8 }),
  );

  assert.equal(compact.eligibleForQualityRanking, true);
  assert.equal(fragmented.eligibleForQualityRanking, compact.eligibleForQualityRanking);
  assert.equal(fragmented.eligibleForSpeedRanking, compact.eligibleForSpeedRanking);
  assert.equal(fragmented.eligibleForStabilityRanking, compact.eligibleForStabilityRanking);
});

test("common VAD keeps model speech misses separate from real silence", () => {
  const units: VoiceMemoryTranscriptionUnit[] = [
    {
      unitId: "speech-empty",
      modelId: "fun-asr-nano-2512",
      index: 0,
      startMs: 0,
      endMs: 30_000,
      status: "completed",
      attempts: 1,
      retryCount: 0,
      processedAudioMs: 30_000,
      coveredAudioMs: 0,
      segmentCount: 0,
      commonVad: {
        hasSpeech: true,
        speechDurationMs: 20_000,
        silenceDurationMs: 10_000,
        activeFrameRatio: 0.66,
        peak: 0.4,
      },
      outputStatus: "empty_output_on_speech",
      updatedAt: "2026-08-30T00:00:00.000Z",
    },
    {
      unitId: "silence",
      modelId: "fun-asr-nano-2512",
      index: 1,
      startMs: 30_000,
      endMs: 60_000,
      status: "completed",
      attempts: 1,
      retryCount: 0,
      processedAudioMs: 30_000,
      coveredAudioMs: 30_000,
      segmentCount: 0,
      commonVad: {
        hasSpeech: false,
        speechDurationMs: 0,
        silenceDurationMs: 30_000,
        activeFrameRatio: 0,
        peak: 0,
      },
      outputStatus: "vad_silence",
      updatedAt: "2026-08-30T00:00:01.000Z",
    },
  ];
  const stats = statsFromTranscriptionUnits(60_000, units, []);
  assert.equal(stats.taskProgressPercent, 100);
  assert.equal(stats.processedPercent, 100);
  assert.equal(stats.speechCoveragePercent, 0);
  assert.equal(stats.emptyOutputOnSpeechUnits, 1);
  assert.equal(stats.vadSilenceUnits, 1);
  assert.equal(stats.silenceUnits, 1);
  const validity = evaluateVoiceMemoryTranscriptionValidity({
    ...stats,
    finalResultSaved: true,
    terminationReason: "completed",
  });
  assert.equal(validity.dataValidity, "invalid_output_anomaly");
  assert.equal(validity.eligibleForQualityRanking, false);
});

test("obvious decoder repetition is detected conservatively", () => {
  for (const text of ["真的".repeat(16), "这话".repeat(16)]) {
    const analysis = analyzeTranscriptAnomalies(text, 30_000);
    assert.equal(analysis.repetitionLoop, true);
    assert.equal(analysis.abnormalOutput, true);
  }
});

test("a recovered retry still contributes to anomaly counters", () => {
  const unit: VoiceMemoryTranscriptionUnit = {
    unitId: "recovered-loop",
    modelId: "qwen3-asr-0.6b-force",
    index: 0,
    startMs: 0,
    endMs: 30_000,
    status: "completed",
    attempts: 2,
    retryCount: 1,
    processedAudioMs: 30_000,
    coveredAudioMs: 30_000,
    segmentCount: 1,
    commonVad: {
      hasSpeech: true,
      speechDurationMs: 25_000,
      silenceDurationMs: 5_000,
      activeFrameRatio: 0.83,
      peak: 0.5,
    },
    outputStatus: "normal",
    anomalyTypes: ["repetition_loop"],
    updatedAt: "2026-08-30T00:00:00.000Z",
  };
  const stats = statsFromTranscriptionUnits(
    30_000,
    [unit],
    [
      {
        id: "segment-1",
        recordingId: "recording-1",
        startMs: 0,
        endMs: 30_000,
        speakerId: "S01",
        confidence: "high",
        text: "重试后得到的正常文本",
      },
    ],
  );
  assert.equal(stats.repetitionLoopCount, 1);
  assert.equal(stats.abnormalOutputCount, 1);
  assert.equal(stats.speechCoveragePercent, 100);
});

test("cross-model checks flag a clear empty outlier and create a review candidate", () => {
  const modelIds: AiAsrModelId[] = [
    "qwen3-asr-1.7b-force",
    "glm-asr-nano-2512",
    "fun-asr-nano-2512",
  ];
  const textByModel: Record<AiAsrModelId, string> = {
    "qwen3-asr-1.7b-force": "这是一段包含游戏背景和快速口语的完整测试内容",
    "glm-asr-nano-2512": "这是一段包含游戏背景以及快速口语的完整测试内容",
    "fun-asr-nano-2512": "",
    "qwen3-asr-0.6b-force": "",
    "fireredasr2-aed": "",
    "paraformer-zh": "",
    "moss-transcribe-diarize-0.9b": "",
    "moss-transcribe-diarize-0.9b-q8_0": "",
    "dolphin-cn-dialect-0.4b": "",
    "cohere-transcribe-2b": "",
    "ark-asr-3b-q8_0": "",
  };
  const variants = Object.fromEntries(
    modelIds.map((modelId) => {
      const text = textByModel[modelId];
      return [
        modelId,
        {
          model: { id: modelId, name: modelId },
          speakers: [],
          transcript: text
            ? [
                {
                  id: `${modelId}-segment`,
                  recordingId: "recording-1",
                  startMs: 0,
                  endMs: 30_000,
                  speakerId: "S01",
                  confidence: "high" as const,
                  text,
                },
              ]
            : [],
          transcriptionUnits: [
            {
              unitId: `${modelId}-unit`,
              modelId,
              index: 0,
              startMs: 0,
              endMs: 30_000,
              status: "completed" as const,
              attempts: 1,
              retryCount: 0,
              processedAudioMs: 30_000,
              coveredAudioMs: text ? 30_000 : 0,
              segmentCount: text ? 1 : 0,
              commonVad: {
                hasSpeech: true,
                speechDurationMs: 24_000,
                silenceDurationMs: 6_000,
                activeFrameRatio: 0.8,
                peak: 0.5,
              },
              outputStatus: text ? ("normal" as const) : ("empty_output_on_speech" as const),
              updatedAt: "2026-08-30T00:00:00.000Z",
            },
          ],
          transcriptionStats: completeStats({
            audioDurationMs: 30_000,
            processedAudioMs: 30_000,
            coveredAudioMs: text ? 30_000 : 0,
            totalUnits: 1,
            completedUnits: 1,
            segmentCount: text ? 1 : 0,
            speechUnits: 1,
            speechWithOutputUnits: text ? 1 : 0,
            emptyOutputOnSpeechUnits: text ? 0 : 1,
            speechCoveragePercent: text ? 100 : 0,
          }),
          updatedAt: "2026-08-30T00:00:00.000Z",
        },
      ];
    }),
  ) as VoiceMemoryRecord["transcriptionVariants"];
  const analysis = analyzeModelComparison({
    record: { transcriptionVariants: variants } as VoiceMemoryRecord,
    modelIds,
    results: {},
  });
  const fun = analysis.modelSummary.find((model) => model.modelId === "fun-asr-nano-2512");
  assert.equal(fun?.suspectedTruncationCount, 1);
  assert.equal(analysis.reviewCandidates[0]?.priority, "high");
  assert.deepEqual(analysis.reviewCandidates[0]?.affectedModels, ["fun-asr-nano-2512"]);
});
