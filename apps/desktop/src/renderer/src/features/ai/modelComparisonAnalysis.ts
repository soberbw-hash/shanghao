import {
  AI_ASR_MODEL_NAMES,
  evaluateVoiceMemoryTranscriptionValidity,
  type AiAsrModelId,
  type AiModelStatus,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptionUnit,
  type VoiceMemoryTranscriptionVariant,
} from "@private-voice/shared";

import type { ModelComparisonResult } from "./modelComparisonQueue";

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

const textForUnit = (
  variant: VoiceMemoryTranscriptionVariant,
  unit: VoiceMemoryTranscriptionUnit,
): string =>
  variant.transcript
    .filter((segment) => segment.startMs < unit.endMs && segment.endMs > unit.startMs)
    .map((segment) => segment.text)
    .join("");

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
            outputStatus?: VoiceMemoryTranscriptionUnit["outputStatus"];
          }
        >
      >;
    }
  >();
  for (const [modelId, variant] of variants) {
    for (const unit of variant.transcriptionUnits ?? []) {
      const key = `${unit.startMs}:${unit.endMs}`;
      const range = rangeMap.get(key) ?? {
        startMs: unit.startMs,
        endMs: unit.endMs,
        commonVadHasSpeech: false,
        outputs: {},
      };
      const outputText = textForUnit(variant, unit);
      range.commonVadHasSpeech ||= unit.commonVad?.hasSpeech === true;
      range.outputs[modelId] = {
        hasOutput: outputText.trim().length > 0,
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
          .filter(([otherId]) => otherId !== modelId)
          .map(([, other]) => other.textLength)
          .filter((value) => value > 0);
        const otherMedianTextLength = median(otherLengths);
        const suspectedTruncation = Boolean(
          range.commonVadHasSpeech &&
          otherLengths.length >= 2 &&
          otherMedianTextLength !== undefined &&
          otherMedianTextLength >= 12 &&
          output.textLength < Math.max(3, otherMedianTextLength * 0.25),
        );
        if (suspectedTruncation)
          suspectedTruncations.set(modelId, (suspectedTruncations.get(modelId) ?? 0) + 1);
        return { modelId, ...output, otherMedianTextLength, suspectedTruncation };
      });
      const repeated = checks
        .filter((check) => check.abnormalRepetition)
        .map((check) => check.modelId);
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
          reason: "输出明显短于同时间段的其他模型，疑似漏转或截断",
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
    const failedBeforeDurableStart = queueResult?.status === "failed" && !validity.complete;
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
      loadTimeMs: stats?.loadElapsedMs,
      inferenceTimeMs: stats?.inferenceElapsedMs,
      alignmentTimeMs: stats?.alignmentElapsedMs,
      saveTimeMs: stats?.saveElapsedMs,
      releaseTimeMs: stats?.releaseElapsedMs,
      totalTimeMs: stats?.totalElapsedMs ?? variant?.transcriptionElapsedMs,
    };
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
      modelName: variant?.model.name ?? AI_ASR_MODEL_NAMES[modelId],
      modelVersion: variant?.model.version ?? modelStatus?.activeRevision,
      status: failedBeforeDurableStart ? ("failed" as const) : validity.status,
      dataValidity: failedBeforeDurableStart
        ? ("invalid_runtime_error" as const)
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
      ...timing,
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

  return {
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
