import {
  AI_ASR_MODEL_NAMES,
  evaluateVoiceMemoryTranscriptionValidity,
  hasUnreliableTranscript,
  isReliableTranscriptText,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

import type { ModelComparisonResult } from "./modelComparisonQueue";
import { analyzeModelComparison } from "./modelComparisonAnalysis";

export interface ModelComparisonExportInput {
  recording: RecordingLibraryItem;
  recordingTitle: string;
  audioDurationMs?: number;
  record?: VoiceMemoryRecord;
  modelIds: AiAsrModelId[];
  results: Partial<Record<AiAsrModelId, ModelComparisonResult>>;
  /** Optional human reference. Metrics are omitted when it is not supplied. */
  groundTruthText?: string;
  benchmarkId?: string;
  expectedKeywords?: string[];
  environment?: Record<string, unknown>;
  models?: AiModelStatus[];
}

const modelDisplayName = (modelId: AiAsrModelId): string => AI_ASR_MODEL_NAMES[modelId] ?? modelId;

const sourceFileName = (filePath: string): string =>
  filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;

const segmentSpeakerName = (
  record: VoiceMemoryRecord | undefined,
  segment: VoiceMemoryTranscriptSegment,
) => {
  const speaker = record?.speakers.find((candidate) => candidate.speakerId === segment.speakerId);
  return (
    segment.nickname ??
    segment.displayNameSnapshot ??
    speaker?.nickname ??
    speaker?.displayNameSnapshot ??
    segment.speakerId
  );
};

const getVariant = (record: VoiceMemoryRecord | undefined, modelId: AiAsrModelId) => {
  const saved = record?.transcriptionVariants?.[modelId];
  if (saved) return saved;
  if (record?.transcriptionModel?.id !== modelId || !record.transcript.length) return undefined;
  return {
    model: record.transcriptionModel,
    transcript: record.transcript,
    speakers: record.speakers,
    pipelineVersion: record.transcriptionPipelineVersion,
    transcriptionElapsedMs: record.transcriptionElapsedMs,
    transcriptionStats: record.transcriptionStats,
    transcriptionUnits: record.transcriptionUnits,
    updatedAt: record.updatedAt,
  };
};

const exportSegment = (
  record: VoiceMemoryRecord | undefined,
  segment: VoiceMemoryTranscriptSegment,
) => ({
  id: segment.id,
  startMs: segment.startMs,
  endMs: segment.endMs,
  speakerId: segment.speakerId,
  speakerName: segmentSpeakerName(record, segment),
  text: segment.text,
  confidence: segment.confidence,
  words: segment.words ?? [],
});

const speakerShares = (
  record: VoiceMemoryRecord | undefined,
  transcript: readonly VoiceMemoryTranscriptSegment[],
) => {
  const durations = new Map<string, { name: string; durationMs: number }>();
  for (const segment of transcript) {
    const speakerId = segment.speakerId || "unknown";
    const current = durations.get(speakerId) ?? {
      name: segmentSpeakerName(record, segment),
      durationMs: 0,
    };
    current.durationMs += Math.max(1, segment.endMs - segment.startMs);
    durations.set(speakerId, current);
  }
  const totalSpeakingMs = [...durations.values()].reduce(
    (sum, speaker) => sum + speaker.durationMs,
    0,
  );
  return [...durations.entries()]
    .map(([speakerId, speaker]) => ({
      speakerId,
      speakerName: speaker.name,
      speakingDurationMs: speaker.durationMs,
      speakingSharePercent: totalSpeakingMs > 0 ? (speaker.durationMs / totalSpeakingMs) * 100 : 0,
    }))
    .sort((left, right) => right.speakingDurationMs - left.speakingDurationMs);
};

const normalizedEvaluationText = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/gu, "").trim();

const codePoints = (text: string): string[] => Array.from(normalizedEvaluationText(text));

const levenshteinDistance = (left: string[], right: string[]): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex] ?? 0;
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      previous[rightIndex] = Math.min(
        (previous[rightIndex - 1] ?? 0) + 1,
        above + 1,
        diagonal + cost,
      );
      diagonal = above;
    }
  }
  return previous[right.length] ?? left.length;
};

const evaluateAgainstGroundTruth = (
  transcriptText: string,
  groundTruthText: string,
  expectedKeywords: string[] | undefined,
) => {
  const reference = codePoints(groundTruthText);
  const hypothesis = codePoints(transcriptText);
  const distance = levenshteinDistance(reference, hypothesis);
  const normalizedHypothesis = normalizedEvaluationText(transcriptText);
  const keywords = (expectedKeywords ?? []).map((keyword) => normalizedEvaluationText(keyword));
  const matchedKeywords = keywords.filter(
    (keyword) => keyword.length > 0 && normalizedHypothesis.includes(keyword),
  );
  // Both inputs are bounded transcript text; this intentionally extracts plain decimal tokens.
  // eslint-disable-next-line security/detect-unsafe-regex
  const referenceNumbers = normalizedEvaluationText(groundTruthText).match(/\d+(?:\.\d+)?/gu) ?? [];
  // eslint-disable-next-line security/detect-unsafe-regex
  const hypothesisNumbers = new Set(normalizedHypothesis.match(/\d+(?:\.\d+)?/gu) ?? []);
  const matchedNumbers = referenceNumbers.filter((value) => hypothesisNumbers.has(value));
  return {
    referenceText: groundTruthText,
    referenceCharacterCount: reference.length,
    hypothesisCharacterCount: hypothesis.length,
    editDistance: distance,
    cer: reference.length > 0 ? distance / reference.length : undefined,
    keywordAccuracy: keywords.length > 0 ? matchedKeywords.length / keywords.length : undefined,
    numberAccuracy:
      referenceNumbers.length > 0 ? matchedNumbers.length / referenceNumbers.length : undefined,
    matchedNumbers,
    missingNumbers: referenceNumbers.filter((value) => !hypothesisNumbers.has(value)),
    matchedKeywords,
    missingKeywords: keywords.filter((keyword) => !matchedKeywords.includes(keyword)),
    note: "CER 使用规范化后的 Unicode 字符计算；未提供参考文本时不生成本地准确率。",
  };
};

const parseRawRuntimeOutput = (value: string | undefined): unknown => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const modelAnomalies = (
  record: VoiceMemoryRecord | undefined,
  variant: ReturnType<typeof getVariant>,
) => {
  if (!variant) return [];
  const anomalies: Array<Record<string, unknown>> = [];
  for (const unit of variant.transcriptionUnits ?? []) {
    if (unit.status === "failed") {
      anomalies.push({
        type: "failed_unit",
        unitId: unit.unitId,
        index: unit.index,
        startMs: unit.startMs,
        endMs: unit.endMs,
        errorCode: unit.errorCode,
        errorMessage: unit.errorMessage,
      });
    } else if (unit.status === "completed" && unit.outputStatus === "empty_output_on_speech") {
      anomalies.push({
        type: "empty_output_on_speech",
        unitId: unit.unitId,
        index: unit.index,
        startMs: unit.startMs,
        endMs: unit.endMs,
      });
    } else if (unit.outputStatus === "repetition_loop" || unit.outputStatus === "abnormal_output") {
      anomalies.push({
        type: unit.outputStatus,
        unitId: unit.unitId,
        index: unit.index,
        startMs: unit.startMs,
        endMs: unit.endMs,
        anomalyTypes: unit.anomalyTypes,
      });
    }
  }
  for (const segment of variant.transcript) {
    if (!isReliableTranscriptText(segment.text, Math.max(100, segment.endMs - segment.startMs))) {
      anomalies.push({ type: "unreliable_text", segmentId: segment.id, text: segment.text });
    }
  }
  if (hasUnreliableTranscript(variant.transcript)) {
    anomalies.push({
      type: "transcript_quality_warning",
      message: "转录中存在疑似状态词、乱码或重复内容。",
    });
  }
  return anomalies;
};

export const buildModelComparisonExport = ({
  recording,
  recordingTitle,
  audioDurationMs,
  record,
  modelIds,
  results,
  groundTruthText,
  benchmarkId,
  expectedKeywords,
  environment,
  models,
}: ModelComparisonExportInput) => ({
  schemaVersion: 2,
  exportedAt: new Date().toISOString(),
  purpose: "同一条录音的多模型转录对比数据，供人工或 GPT 分析；无参考文本时不生成准确率结论。",
  comparison: {
    runOrder: modelIds,
    modelCount: modelIds.length,
    benchmarkId,
    groundTruthAvailable: Boolean(groundTruthText?.trim()),
    testMode: record?.transcriptionBenchmark?.mode,
    benchmarkClips: record?.transcriptionBenchmark?.clips,
    environment: { ...record?.transcriptionBenchmark?.environment, ...environment },
    measurementNotes: [
      "模型按 runOrder 顺序逐个运行；只有全部计划单元可靠完成并持久化的模型才会标记 success。",
      "taskProgressPercent 是任务完成度；processedSpeechPercent 是计划语音处理度；speechRatioPercent 是样本中的语音占比。",
      "processedAudioMs / coveredAudioMs / failedUnits 用于区分速度问题、模型问题和流水线缺口。",
      "rawRuntimeOutput 是各分块保存的运行快照；finalSegments 是当前持久化的最终分段。",
    ],
  },
  groundTruth: groundTruthText?.trim()
    ? {
        text: groundTruthText,
        normalizedText: normalizedEvaluationText(groundTruthText),
        expectedKeywords: expectedKeywords ?? [],
      }
    : undefined,
  recording: {
    recordingId: recording.recordingId,
    title: recordingTitle,
    sourceFileName: sourceFileName(recording.filePath),
    roomId: recording.roomId,
    roomName: record?.roomName ?? recording.roomId,
    createdAt: record?.createdAt,
    durationMs: audioDurationMs,
  },
  ...(() => {
    const analysis = analyzeModelComparison({ record, modelIds, results, models });
    return {
      environment: { ...record?.transcriptionBenchmark?.environment, ...environment },
      modelSummary: analysis.modelSummary,
      crossModelConsistency: analysis.crossModelUnits,
      reviewCandidates: analysis.reviewCandidates,
    };
  })(),
  models: modelIds.map((modelId) => {
    const result = results[modelId];
    const variant = getVariant(record, modelId);
    const transcript = variant?.transcript ?? [];
    const attemptElapsedMs = result?.elapsedMs ?? variant?.transcriptionElapsedMs;
    const baseStats = variant?.transcriptionStats;
    const legacyAllUnitsCompleted = Boolean(
      baseStats?.totalUnits &&
      baseStats.completedUnits === baseStats.totalUnits &&
      (baseStats.pendingUnits ?? 0) === 0 &&
      (baseStats.runningUnits ?? 0) === 0 &&
      baseStats.failedUnits === 0,
    );
    const transcriptionStats = baseStats
      ? {
          ...baseStats,
          processedAudioMs: result?.processedAudioMs ?? baseStats.processedAudioMs,
          coveredAudioMs: result?.coveredAudioMs ?? baseStats.coveredAudioMs,
          retryCount: result?.retryCount ?? baseStats.retryCount,
          failedUnits: result?.failedUnits ?? baseStats.failedUnits,
          completedUnits: result?.completedUnits ?? baseStats.completedUnits,
          totalUnits: result?.totalUnits ?? baseStats.totalUnits,
          scheduledSpeechMs:
            baseStats.scheduledSpeechMs ??
            (legacyAllUnitsCompleted ? baseStats.processedAudioMs : undefined),
          processedSpeechPercent:
            baseStats.processedSpeechPercent ??
            (legacyAllUnitsCompleted ? 100 : baseStats.processedPercent),
          speechRatioPercent: baseStats.speechRatioPercent ?? baseStats.processedPercent,
        }
      : undefined;
    const validity = evaluateVoiceMemoryTranscriptionValidity(
      transcriptionStats,
      variant?.transcriptionUnits,
    );
    const failedBeforeDurableStart = result?.status === "failed" && !validity.complete;
    const statsComplete = validity.complete;
    const trulyComplete = statsComplete;
    const completionPercent = transcriptionStats
      ? Math.max(
          0,
          Math.min(
            100,
            statsComplete
              ? 100
              : (transcriptionStats.taskProgressPercent ??
                  (transcriptionStats.totalUnits > 0
                    ? ((transcriptionStats.completedUnits + transcriptionStats.failedUnits) /
                        transcriptionStats.totalUnits) *
                      100
                    : 0)),
          ),
        )
      : 0;
    const status = failedBeforeDurableStart ? ("failed" as const) : validity.status;
    const elapsedMs = status === "success" ? attemptElapsedMs : undefined;
    const measuredAudioMs = transcriptionStats?.processedAudioMs ?? audioDurationMs;
    const statsTotalAudioMs = transcriptionStats?.audioDurationMs;
    const statsCoveredAudioMs = transcriptionStats?.coveredAudioMs;
    const anomalies = modelAnomalies(record, variant);
    const rawRuntimeOutput = (variant?.transcriptionUnits ?? []).map((unit) => ({
      unitId: unit.unitId,
      index: unit.index,
      startMs: unit.startMs,
      endMs: unit.endMs,
      speakerId: unit.speakerId,
      status: unit.status,
      attempts: unit.attempts,
      retryCount: unit.retryCount,
      processedAudioMs: unit.processedAudioMs,
      coveredAudioMs: unit.coveredAudioMs,
      segmentCount: unit.segmentCount,
      commonVad: unit.commonVad,
      outputStatus: unit.outputStatus,
      anomalyTypes: unit.anomalyTypes,
      timing: unit.timing,
      resourceUsage: unit.resourceUsage,
      stage: unit.stage,
      errorCode: unit.errorCode,
      errorMessage: unit.errorMessage,
      startedAt: unit.startedAt,
      completedAt: unit.completedAt,
      heartbeatAt: unit.heartbeatAt,
      raw: parseRawRuntimeOutput(unit.rawRuntimeOutput),
    }));
    const evaluation = groundTruthText?.trim()
      ? evaluateAgainstGroundTruth(
          transcript.map((segment) => segment.text).join("\n"),
          groundTruthText,
          expectedKeywords,
        )
      : undefined;
    return {
      modelId,
      modelName: modelDisplayName(modelId),
      status,
      dataValidity: failedBeforeDurableStart ? "invalid_runtime_error" : validity.dataValidity,
      eligibleForQualityRanking: failedBeforeDurableStart
        ? false
        : validity.eligibleForQualityRanking,
      eligibleForSpeedRanking: failedBeforeDurableStart ? false : validity.eligibleForSpeedRanking,
      eligibleForStabilityRanking: failedBeforeDurableStart
        ? false
        : validity.eligibleForStabilityRanking,
      exclusionReasons: failedBeforeDurableStart
        ? [...validity.exclusionReasons, result.message ?? "模型运行失败"]
        : validity.exclusionReasons,
      recommendedAction: failedBeforeDurableStart
        ? "修复运行时错误后重新测试"
        : validity.recommendedAction,
      completionPercent,
      elapsedMs,
      attemptElapsedMs,
      elapsedSeconds: elapsedMs === undefined ? undefined : elapsedMs / 1_000,
      realTimeFactor:
        elapsedMs === undefined || measuredAudioMs === undefined || measuredAudioMs <= 0
          ? undefined
          : elapsedMs / measuredAudioMs,
      error:
        result?.message ?? (variant && !trulyComplete ? "transcription_incomplete" : undefined),
      model: variant?.model,
      pipelineVersion: variant?.pipelineVersion,
      updatedAt: variant?.updatedAt,
      transcriptionStats,
      timeBreakdown: {
        totalElapsedMs: attemptElapsedMs,
        inferenceElapsedMs: transcriptionStats?.inferenceElapsedMs,
        conversionElapsedMs: transcriptionStats?.conversionElapsedMs,
        processedAudioMs: transcriptionStats?.processedAudioMs,
        coveredAudioMs: transcriptionStats?.coveredAudioMs,
      },
      processedAudioMs: transcriptionStats?.processedAudioMs,
      coveredAudioMs: transcriptionStats?.coveredAudioMs,
      taskProgressPercent: transcriptionStats?.taskProgressPercent,
      scheduledSpeechMs: transcriptionStats?.scheduledSpeechMs,
      processedSpeechPercent: transcriptionStats?.processedSpeechPercent,
      speechRatioPercent: transcriptionStats?.speechRatioPercent,
      processedPercent: transcriptionStats?.processedPercent,
      speechCoveragePercent: transcriptionStats?.speechCoveragePercent,
      coveragePercent:
        result?.coveragePercent ??
        (statsTotalAudioMs !== undefined &&
        statsCoveredAudioMs !== undefined &&
        statsTotalAudioMs > 0
          ? (statsCoveredAudioMs / statsTotalAudioMs) * 100
          : undefined),
      speakerCount: variant?.speakers.length ?? 0,
      speakers: variant?.speakers ?? [],
      speakerShares: speakerShares(record, transcript),
      text: transcript.map((segment) => segment.text).join("\n"),
      rawSegments: transcript.flatMap((segment) => segment.rawSegments ?? []),
      rawRuntimeOutput,
      normalizedSegments: transcript.map((segment) => exportSegment(record, segment)),
      finalSegments: transcript.map((segment) => exportSegment(record, segment)),
      anomalies,
      evaluation,
      segments: transcript.map((segment) => exportSegment(record, segment)),
    };
  }),
});

export const downloadModelComparisonExport = (payload: object, fileName: string): void => {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const buildModelComparisonSummaryExport = (
  payload: ReturnType<typeof buildModelComparisonExport>,
) => ({
  schemaVersion: 1,
  exportedAt: payload.exportedAt,
  recording: payload.recording,
  environment: payload.environment,
  testMode: payload.comparison.testMode,
  groundTruthAvailable: payload.comparison.groundTruthAvailable,
  modelSummary: payload.modelSummary,
  dataValidity: payload.modelSummary.map((model) => ({
    modelId: model.modelId,
    status: model.status,
    dataValidity: model.dataValidity,
    exclusionReasons: model.exclusionReasons,
    recommendedAction: model.recommendedAction,
  })),
  rankingEligibility: payload.modelSummary.map((model) => ({
    modelId: model.modelId,
    eligibleForQualityRanking: model.eligibleForQualityRanking,
    eligibleForSpeedRanking: model.eligibleForSpeedRanking,
    eligibleForStabilityRanking: model.eligibleForStabilityRanking,
  })),
  timing: payload.modelSummary.map((model) => ({
    modelId: model.modelId,
    loadTimeMs: model.loadTimeMs,
    inferenceTimeMs: model.inferenceTimeMs,
    alignmentTimeMs: model.alignmentTimeMs,
    saveTimeMs: model.saveTimeMs,
    releaseTimeMs: model.releaseTimeMs,
    totalTimeMs: model.totalTimeMs,
    coldStartSpeedX: model.coldStartSpeedX,
    inferenceOnlySpeedX: model.inferenceOnlySpeedX,
    RTF: model.RTF,
  })),
  resourceUsage: payload.modelSummary.map((model) => ({
    modelId: model.modelId,
    device: model.device,
    backend: model.backend,
    quantization: model.quantization,
    dtype: model.dtype,
    modelFileSize: model.modelFileSize,
    gpuMemoryBeforeLoadMb: model.gpuMemoryBeforeLoadMb,
    gpuMemoryAfterLoadMb: model.gpuMemoryAfterLoadMb,
    gpuPeakMemoryMb: model.gpuPeakMemoryMb,
    gpuMemoryAfterReleaseMb: model.gpuMemoryAfterReleaseMb,
    ramPeakMb: model.ramPeakMb,
    oomCount: model.oomCount,
    workerCrashCount: model.workerCrashCount,
    resourceReleaseSucceeded: model.resourceReleaseSucceeded,
    possibleResourceLeak: model.possibleResourceLeak,
  })),
  coverage: payload.modelSummary.map((model) => ({
    modelId: model.modelId,
    taskProgressPercent: model.taskProgressPercent,
    processedPercent: model.processedPercent,
    speechCoveragePercent: model.speechCoveragePercent,
    speechUnits: model.speechUnits,
    vadSilenceUnits: model.vadSilenceUnits,
    emptyOutputOnSpeechUnits: model.emptyOutputOnSpeechUnits,
  })),
  anomalies: payload.modelSummary.map((model) => ({
    modelId: model.modelId,
    repetitionLoopCount: model.repetitionLoopCount,
    abnormalOutputCount: model.abnormalOutputCount,
    hallucinationSuspectedCount: model.hallucinationSuspectedCount,
    suspectedTruncationCount: model.suspectedTruncationCount,
  })),
  reviewCandidates: payload.reviewCandidates,
});
