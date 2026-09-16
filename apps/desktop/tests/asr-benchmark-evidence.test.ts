import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateVoiceMemoryTranscriptionValidity,
  type VoiceMemoryTranscriptionStats,
} from "@private-voice/shared";
import { measureAsrRelease } from "../src/main/asr-resource-release";
import { analyzeModelComparison } from "../src/renderer/src/features/ai/modelComparisonAnalysis";
import {
  comparisonTextForUnit,
  carryoverEvidence,
} from "../src/renderer/src/features/ai/modelComparisonReview";

const stats: VoiceMemoryTranscriptionStats = {
  audioDurationMs: 600_000,
  processedAudioMs: 900_000,
  coveredAudioMs: 900_000,
  scheduledSpeechMs: 900_000,
  totalUnits: 3,
  completedUnits: 3,
  failedUnits: 0,
  retryCount: 0,
  segmentCount: 3,
  speakerCount: 3,
  finalResultSaved: true,
  terminationReason: "completed",
  totalElapsedMs: 60_000,
  inferenceElapsedMs: 30_000,
  loadElapsedMs: 10_000,
  alignmentElapsedMs: 5_000,
};

test("output evidence affects quality without suppressing complete runtime evidence", () => {
  const anomalous = evaluateVoiceMemoryTranscriptionValidity({ ...stats, repetitionLoopCount: 1 });
  assert.equal(anomalous.dataValidity, "invalid_output_anomaly");
  assert.equal(anomalous.eligibleForQualityRanking, false);
  assert.equal(anomalous.eligibleForSpeedRanking, true);
  const review = evaluateVoiceMemoryTranscriptionValidity({
    ...stats,
    emptyOutputOnSpeechUnits: 1,
  });
  assert.equal(review.dataValidity, "valid_with_review");
  assert.equal(review.eligibleForQualityRanking, true);
  assert.deepEqual(review.exclusionReasons, []);
  assert.ok(review.reviewReasons.length > 0);
  const crashed = evaluateVoiceMemoryTranscriptionValidity({
    ...stats,
    resourceUsage: { workerCrashCount: 1 },
  });
  assert.equal(crashed.eligibleForSpeedRanking, false);
});

test("merged sentence cannot masquerade as the next short unit's full output", () => {
  const variant = {
    transcript: [
      {
        startMs: 0,
        endMs: 4600,
        text: "上一句很长嗯",
        words: [
          { startMs: 0, endMs: 4000, text: "上一句很长" },
          { startMs: 4000, endMs: 4600, text: "嗯" },
        ],
      },
    ],
  } as never;
  const unit = { startMs: 4000, endMs: 4600 };
  assert.equal(comparisonTextForUnit(variant, unit as never), "嗯");
  assert.equal(
    comparisonTextForUnit(variant, {
      ...unit,
      rawRuntimeOutput: JSON.stringify({ segments: [] }),
    } as never),
    "",
  );
  assert.equal(
    comparisonTextForUnit(variant, {
      ...unit,
      rawRuntimeOutput: JSON.stringify({ segments: [{ text: "原始单元" }] }),
    } as never),
    "原始单元",
  );
});

test("short units are never truncated by peer length alone, including real short phrases", () => {
  const modelIds = ["glm-asr-nano-2512", "fun-asr-nano-2512", "qwen3-asr-0.6b-force"] as const;
  for (const duration of [500, 600, 900, 1200])
    for (const text of ["嗯", "啊", "对", "", "往左"]) {
      const transcriptionVariants = Object.fromEntries(
        modelIds.map((modelId, index) => [
          modelId,
          {
            model: { id: modelId, name: modelId },
            transcript: [],
            speakers: [],
            transcriptionUnits: [
              {
                startMs: 0,
                endMs: duration,
                commonVad: { hasSpeech: true },
                rawRuntimeOutput: JSON.stringify({
                  segments: [
                    { text: index ? "上一句非常长的内容不应该作为当前短片段的真值" : text },
                  ],
                }),
              },
            ],
          },
        ]),
      );
      const analysis = analyzeModelComparison({
        record: { transcriptionVariants } as never,
        modelIds: [...modelIds],
        results: {},
      });
      assert.ok(
        analysis.crossModelUnits.every((unit) =>
          unit.models.every((model) => !model.suspectedTruncation),
        ),
      );
    }
});

test("carryover is review-only and reports source overlap separately", () => {
  const text = "你先把墙补一下然后我们再出去";
  const previous = { text, startMs: 0, endMs: 4000 };
  const evidence = carryoverEvidence({ text, startMs: 4000, endMs: 4600 }, previous);
  assert.equal(evidence.possibleCarryover, true);
  assert.equal(evidence.previousUnitSimilarity, 1);
  assert.equal(evidence.audioRangeOverlapMs, 0);
  assert.equal(
    carryoverEvidence({ text, startMs: 4000, endMs: 8000 }, previous).possibleCarryover,
    false,
  );
});

test("clip wall speed uses recording duration and accounts for unattributed time", () => {
  const analysis = analyzeModelComparison({
    record: {
      schemaVersion: 1,
      recordingId: "r",
      filePath: "r.m4a",
      createdAt: "now",
      updatedAt: "now",
      phase: "ready",
      progress: 100,
      transcript: [],
      speakers: [],
      transcriptionModel: { id: "paraformer-zh", name: "Paraformer" },
      transcriptionStats: stats,
    } as never,
    modelIds: ["paraformer-zh"],
    results: {},
  });
  const row = analysis.modelSummary[0]!;
  assert.equal(row.clipWallSpeedX, 10);
  assert.equal(row.coldStartSpeedX, 15);
  assert.equal(row.unaccountedTimeMs, 15_000);
});

test("release sampling waits for actual exit and delayed CUDA memory recovery", async () => {
  let exited = false;
  const samples = [5_000, 5_000, 4_000, 1_000];
  const result = await measureAsrRelease(
    {
      releaseAndWait: async () => {
        exited = true;
        return { workerExited: true, workerExitedAt: "now" };
      },
    },
    "test",
    1_000,
    async () => {
      assert.equal(exited, true);
      return samples.shift() ?? 1_000;
    },
    async () => undefined,
  );
  assert.equal(result.memoryAfterWorkerExitMb, 5_000);
  assert.equal(result.gpuMemoryAfterReleaseMb, 1_000);
  assert.equal(result.possibleResourceLeak, false);
  const stalled = await measureAsrRelease(
    { releaseAndWait: async () => ({ workerExited: false, workerExitedAt: "" }) },
    "test",
    1_000,
    async () => 1_000,
    async () => undefined,
  );
  assert.equal(stalled.resourceReleaseSucceeded, false);
  assert.equal(stalled.workerExitedAt, undefined);
});
