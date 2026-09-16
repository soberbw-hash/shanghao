import {
  AI_ASR_MODEL_NAMES,
  AI_ASR_PRODUCT_CLASSES,
  evaluateVoiceMemoryTranscriptionValidity,
  type AiAsrModelId,
  type AiModelStatus,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptionUnit,
  type VoiceMemoryTranscriptionVariant,
} from "@private-voice/shared";

import type { ModelComparisonResult } from "./modelComparisonQueue";
import {
  BENCHMARK_REVIEW_CONFIG,
  carryoverEvidence,
  comparisonTextForUnit,
} from "./modelComparisonReview";

export interface ModelComparisonReviewCandidate {
  startMs: number;
  endMs: number;
  reason: string;
  affectedModels: AiAsrModelId[];
  priority: "medium" | "high" | "critical";
}

const variantFor = (
  record: VoiceMemoryRecord | undefined,
  modelId: AiAsrModelId,
): VoiceMemoryTranscriptionVariant | undefined => {
  const saved = record?.transcriptionVariants?.[modelId];
  if (saved) return saved;
  if (record?.transcriptionModel?.id !== modelId) return undefined;
  return {
    model: record.transcriptionModel,
    transcript: record.transcript,
    speakers: record.speakers,
    pipelineVersion: record.transcriptionPipelineVersion,
    transcriptionElapsedMs: record.transcriptionElapsedMs,
    transcriptionStats: record.transcriptionStats,
    transcriptionUnits: record.transcriptionUnits,
    benchmark: record.transcriptionBenchmark,
    updatedAt: record.updatedAt,
  };
};

const clampPercent = (value: number | undefined): number =>
  Math.max(0, Math.min(100, Number.isFinite(value) ? (value as number) : 0));

const median = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

export const analyzeModelComparison = (options: {
  record?: VoiceMemoryRecord;
  modelIds: AiAsrModelId[];
  results: Partial<Record<AiAsrModelId, ModelComparisonResult>>;
  models?: AiModelStatus[];
}) => {
  const variants = new Map<AiAsrModelId, VoiceMemoryTranscriptionVariant>();
  for (const modelId of options.modelIds) {
    const variant = variantFor(options.record, modelId);
    if (variant) variants.set(modelId, variant);
  }

  const rangeMap = new Map<
    string,
    {
      startMs: number;
      endMs: number;
      commonVadHasSpeech: boolean;
      outputs: Partial<
        Record<
          AiAsrModelId,
          {
            hasOutput: boolean;
            textLength: number;
            outputText: string;
            outputDurationMs: number;
            abnormalRepetition: boolean;
            possibleCarryover: boolean;
            previousUnitSimilarity: number;
            audioRangeOverlapMs: number;
            outputStatus?: VoiceMemoryTranscriptionUnit["outputStatus"];
          }
        >
      >;
    }
  >();
  for (const [modelId, variant] of variants) {
    const previousBySpeaker = new Map<string, { text: string; startMs: number; endMs: number }>();
    for (const unit of [...(variant.transcriptionUnits ?? [])].sort(
      (a, b) => a.startMs - b.startMs,
    )) {
      const key = `${variant.pipelineVersion ?? "legacy"}:${unit.speakerId ?? "mixed"}:${unit.startMs}:${unit.endMs}`;
      const range = rangeMap.get(key) ?? {
        startMs: unit.startMs,
        endMs: unit.endMs,
        commonVadHasSpeech: false,
        outputs: {},
      };
      const outputText = comparisonTextForUnit(variant, unit);
      const current = { text: outputText, startMs: unit.startMs, endMs: unit.endMs };
      const carryover = carryoverEvidence(
        current,
        previousBySpeaker.get(unit.speakerId ?? "mixed"),
      );
      previousBySpeaker.set(unit.speakerId ?? "mixed", current);
      range.commonVadHasSpeech ||= unit.commonVad?.hasSpeech === true;
      range.outputs[modelId] = {
        hasOutput: /[\p{L}\p{N}]/u.test(outputText),
        ...carryover,
        textLength: Array.from(outputText.replace(/\s+/gu, "")).length,
        outputText,
        outputDurationMs: Math.max(0, unit.endMs - unit.startMs),
        abnormalRepetition: unit.anomalyTypes?.includes("repetition_loop") === true,
        outputStatus: unit.outputStatus,
      };
      rangeMap.set(key, range);
    }
  }

  const suspectedTruncations = new Map<AiAsrModelId, number>();
  const reviewCandidates: ModelComparisonReviewCandidate[] = [];
  const crossModelUnits = [...rangeMap.values()]
    .sort((left, right) => left.startMs - right.startMs)
    .map((range) => {
      const outputEntries = Object.entries(range.outputs) as Array<
        [AiAsrModelId, NonNullable<(typeof range.outputs)[AiAsrModelId]>]
      >;
      const checks = outputEntries.map(([modelId, output]) => {
        const otherLengths = outputEntries
          .filter(
            ([otherId, other]) =>
              otherId !== modelId && !other.possibleCarryover && !other.abnormalRepetition,
          )
          .map(([, other]) => other.textLength)
          .filter((value) => value > 0);
        const otherMedianTextLength = median(otherLengths);
        const suspectedTruncation = Boolean(
          range.commonVadHasSpeech &&
          range.endMs - range.startMs > BENCHMARK_REVIEW_CONFIG.shortUnitMs &&
          otherLengths.length >= 2 &&
          otherMedianTextLength !== undefined &&
          otherMedianTextLength >= BENCHMARK_REVIEW_CONFIG.peerMinimumCharacters &&
          output.textLength <
            Math.max(3, otherMedianTextLength * BENCHMARK_REVIEW_CONFIG.peerLengthRatio),
        );
        if (suspectedTruncation)
          suspectedTruncations.set(modelId, (suspectedTruncations.get(modelId) ?? 0) + 1);
        return { modelId, ...output, otherMedianTextLength, suspectedTruncation };
      });
      const repeated = checks
        .filter((check) => check.abnormalRepetition)
        .map((check) => check.modelId);
      const carried = checks
        .filter((check) => check.possibleCarryover)
        .map((check) => check.modelId);
      if (carried.length)
        reviewCandidates.push({
          startMs: range.startMs,
          endMs: range.endMs,
          reason: "possible_chunk_carryover：短片段与前一片段高度相似，需核对原音频和原始输出",
          affectedModels: carried,
          priority: "high",
        });
      const truncated = checks
        .filter((check) => check.suspectedTruncation)
        .map((check) => check.modelId);
      if (repeated.length) {
        reviewCandidates.push({
          startMs: range.startMs,
          endMs: range.endMs,
          reason: "检测到重复循环或解码异常",
          affectedModels: repeated,
          priority: "critical",
        });
      }
      if (truncated.length) {
        reviewCandidates.push({
          startMs: range.startMs,
          endMs: range.endMs,
          reason: "同区间输出长度差异，需人工核对；其他模型不是真值",
          affectedModels: truncated,
          priority: checks.some(
            (check) => truncated.includes(check.modelId) && check.textLength === 0,
          )
            ? "high"
            : "medium",
        });
      }
      return { ...range, models: checks };
    });

  const modelSummary = options.modelIds.map((modelId) => {
    const variant = variants.get(modelId);
    const stats = variant?.transcriptionStats;
    const validity = evaluateVoiceMemoryTranscriptionValidity(stats, variant?.transcriptionUnits);
    const queueResult = options.results[modelId];
    const failedBeforeDurableStart =
      queueResult?.status === "failed" &&
      (stats?.completedUnits ?? 0) + (stats?.failedUnits ?? 0) === 0;
    const modelStatus = options.models?.find((model) => model.id === modelId);
    const taskProgressPercent =
      stats?.taskProgressPercent ??
      (stats?.totalUnits
        ? ((stats.completedUnits + (stats.failedUnits ?? 0)) / stats.totalUnits) * 100
        : 0);
    const processedPercent =
      stats?.processedPercent ??
      (stats?.audioDurationMs ? (stats.processedAudioMs / stats.audioDurationMs) * 100 : 0);
    const legacyComplete =
      Boolean(stats?.totalUnits) &&
      stats?.completedUnits === stats?.totalUnits &&
      (stats?.failedUnits ?? 0) === 0 &&
      (stats?.pendingUnits ?? 0) === 0 &&
      (stats?.runningUnits ?? 0) === 0;
    const timing = {
      preflightTimeMs: stats?.preflightElapsedMs,
      resourceProbeTimeMs: stats?.resourceProbeElapsedMs,
      loadTimeMs: stats?.loadElapsedMs,
      conversionTimeMs: stats?.conversionElapsedMs,
      providerImportTimeMs: stats?.providerImportElapsedMs,
      modelInitializationTimeMs: stats?.modelInitializationElapsedMs,
      workerStartupTimeMs: stats?.workerStartupElapsedMs,
      vadTimeMs: stats?.vadElapsedMs,
      inferenceTimeMs: stats?.inferenceElapsedMs,
      alignmentTimeMs: stats?.alignmentElapsedMs,
      postprocessTimeMs: stats?.postprocessElapsedMs,
      mergeTimeMs: stats?.mergeElapsedMs,
      saveTimeMs: stats?.saveElapsedMs,
      releaseTimeMs: stats?.releaseElapsedMs,
      totalTimeMs:
        queueResult?.wallElapsedMs ?? stats?.totalElapsedMs ?? variant?.transcriptionElapsedMs,
    };
    // Startup/import/init are breakdowns of loadTime, not additional stages to add twice.
    const knownTimeMs = [
      timing.loadTimeMs,
      timing.conversionTimeMs,
      timing.preflightTimeMs,
      timing.resourceProbeTimeMs,
      timing.vadTimeMs,
      timing.inferenceTimeMs,
      timing.alignmentTimeMs,
      timing.postprocessTimeMs,
      timing.mergeTimeMs,
      timing.saveTimeMs,
      timing.releaseTimeMs,
    ].reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const unaccountedTimeMs =
      timing.totalTimeMs === undefined ? undefined : Math.max(0, timing.totalTimeMs - knownTimeMs);
    const clipDurationMs = stats?.audioDurationMs;
    const clipWallSpeedX =
      clipDurationMs && timing.totalTimeMs && timing.totalTimeMs > 0
        ? clipDurationMs / timing.totalTimeMs
        : undefined;
    const processedAudioMs =
      stats?.processedAudioMs ?? options.results[modelId]?.processedAudioMs ?? 0;
    const coldStartSpeedX =
      timing.totalTimeMs && timing.totalTimeMs > 0
        ? processedAudioMs / timing.totalTimeMs
        : undefined;
    const inferenceOnlySpeedX =
      timing.inferenceTimeMs && timing.inferenceTimeMs > 0
        ? processedAudioMs / timing.inferenceTimeMs
        : undefined;
    return {
      modelId,
      productClass: AI_ASR_PRODUCT_CLASSES[modelId],
      modelName: variant?.model.name ?? AI_ASR_MODEL_NAMES[modelId],
      modelVersion: variant?.model.version ?? modelStatus?.activeRevision,
      status: failedBeforeDurableStart ? ("failed" as const) : validity.status,
      dataValidity: failedBeforeDurableStart
        ? ("invalid_runtime_error" as const)
        : validity.dataValidity === "valid_complete" && (suspectedTruncations.get(modelId) ?? 0) > 0
          ? ("valid_with_review" as const)
          : validity.dataValidity,
      eligibleForQualityRanking: failedBeforeDurableStart
        ? false
        : validity.eligibleForQualityRanking,
      eligibleForSpeedRanking: failedBeforeDurableStart ? false : validity.eligibleForSpeedRanking,
      eligibleForStabilityRanking: failedBeforeDurableStart
        ? false
        : validity.eligibleForStabilityRanking,
      exclusionReasons: failedBeforeDurableStart
        ? [...validity.exclusionReasons, queueResult.message ?? "模型运行失败"]
        : validity.exclusionReasons,
      reviewReasons: validity.reviewReasons,
      recommendedAction: failedBeforeDurableStart
        ? "修复运行时错误后重新测试"
        : validity.recommendedAction,
      completionPercent: clampPercent(taskProgressPercent),
      taskProgressPercent: clampPercent(taskProgressPercent),
      processedPercent: clampPercent(processedPercent),
      scheduledSpeechMs:
        stats?.scheduledSpeechMs ?? (legacyComplete ? stats?.processedAudioMs : undefined),
      processedSpeechPercent: clampPercent(
        stats?.processedSpeechPercent ?? (legacyComplete ? 100 : processedPercent),
      ),
      speechRatioPercent: clampPercent(stats?.speechRatioPercent ?? processedPercent),
      speechCoveragePercent: clampPercent(stats?.speechCoveragePercent),
      totalUnits: stats?.totalUnits ?? 0,
      completedUnits: stats?.completedUnits ?? 0,
      pendingUnits: stats?.pendingUnits ?? 0,
      runningUnits: stats?.runningUnits ?? 0,
      failedUnits: stats?.failedUnits ?? 0,
      speechUnits: stats?.speechUnits ?? 0,
      vadSilenceUnits: stats?.vadSilenceUnits ?? stats?.silenceUnits ?? 0,
      speechWithOutputUnits: stats?.speechWithOutputUnits ?? 0,
      emptyOutputOnSpeechUnits: stats?.emptyOutputOnSpeechUnits ?? 0,
      emptySpeechUnitCount: stats?.emptyOutputOnSpeechUnits ?? 0,
      reviewCandidateCount: reviewCandidates.filter((candidate) =>
        candidate.affectedModels.includes(modelId),
      ).length,
      ...timing,
      unaccountedTimeMs,
      clipDurationMs,
      clipWallSpeedX,
      suspectedOmissionCount: stats?.suspectedOmissionCount ?? 0,
      coldStartSpeedX,
      inferenceOnlySpeedX,
      RTF:
        timing.inferenceTimeMs && processedAudioMs > 0
          ? timing.inferenceTimeMs / processedAudioMs
          : undefined,
      device: stats?.resourceUsage?.device,
      backend: stats?.resourceUsage?.backend,
      quantization: stats?.resourceUsage?.quantization,
      dtype: stats?.resourceUsage?.dtype,
      modelFileSize: stats?.resourceUsage?.modelFileSizeBytes ?? modelStatus?.approximateBytes,
      gpuMemoryBeforeLoadMb: stats?.resourceUsage?.gpuMemoryBeforeLoadMb,
      gpuMemoryAfterLoadMb: stats?.resourceUsage?.gpuMemoryAfterLoadMb,
      gpuPeakMemoryMb: stats?.resourceUsage?.gpuPeakMemoryMb,
      gpuMemoryAfterReleaseMb: stats?.resourceUsage?.gpuMemoryAfterReleaseMb,
      ramPeakMb: stats?.resourceUsage?.ramPeakMb,
      oomCount: stats?.resourceUsage?.oomCount ?? 0,
      workerCrashCount: stats?.resourceUsage?.workerCrashCount ?? 0,
      resourceReleaseSucceeded: stats?.resourceUsage?.resourceReleaseSucceeded,
      possibleResourceLeak: stats?.resourceUsage?.possibleResourceLeak,
      repetitionLoopCount: stats?.repetitionLoopCount ?? 0,
      abnormalOutputCount: stats?.abnormalOutputCount ?? 0,
      hallucinationSuspectedCount: stats?.hallucinationSuspectedCount ?? 0,
      suspectedTruncationCount: suspectedTruncations.get(modelId) ?? 0,
      speakerCount: stats?.speakerCount ?? variant?.speakers.length ?? 0,
    };
  });

  const pipelineVersions = new Set(
    [...variants.values()].map((variant) => variant.pipelineVersion ?? "legacy"),
  );
  if (pipelineVersions.size > 1) {
    for (const summary of modelSummary) {
      summary.eligibleForQualityRanking = false;
      summary.eligibleForSpeedRanking = false;
      summary.eligibleForStabilityRanking = false;
      summary.exclusionReasons.push("测试流水线版本不同，需在同一版本重测后排名");
    }
  }

  return {
    qualityReview: {
      recognitionQuality: { assessment: "requires_human_reference", CER: null },
      completeness: {
        assessment: "requires_meaningful_speech_review",
        emptyOutputIsOmission: false,
      },
      readability: {
        assessment: "requires_human_review",
        criteria: ["标点", "自然断句", "阅读流畅度"],
      },
      engineering: { assessment: "measured_separately" },
    },
    modelSummary,
    crossModelUnits,
    reviewCandidates: reviewCandidates
      .sort((left, right) => {
        const rank = { critical: 0, high: 1, medium: 2 } as const;
        return rank[left.priority] - rank[right.priority] || left.startMs - right.startMs;
      })
      .slice(0, 20),
  };
};
