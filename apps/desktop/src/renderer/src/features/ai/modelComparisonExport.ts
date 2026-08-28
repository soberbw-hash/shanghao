import {
  AI_ASR_MODEL_NAMES,
  hasUnreliableTranscript,
  isReliableTranscriptText,
  type AiAsrModelId,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

import type { ModelComparisonResult } from "./modelComparisonQueue";

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
  return {
    referenceText: groundTruthText,
    referenceCharacterCount: reference.length,
    hypothesisCharacterCount: hypothesis.length,
    editDistance: distance,
    cer: reference.length > 0 ? distance / reference.length : undefined,
    keywordAccuracy: keywords.length > 0 ? matchedKeywords.length / keywords.length : undefined,
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
    } else if (unit.status === "completed" && unit.segmentCount === 0) {
      anomalies.push({
        type: "silence_or_empty_unit",
        unitId: unit.unitId,
        index: unit.index,
        startMs: unit.startMs,
        endMs: unit.endMs,
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
}: ModelComparisonExportInput) => ({
  schemaVersion: 2,
  exportedAt: new Date().toISOString(),
  purpose: "同一条录音的多模型转录对比数据，供人工或 GPT 分析；无参考文本时不生成准确率结论。",
  comparison: {
    runOrder: modelIds,
    modelCount: modelIds.length,
    benchmarkId,
    groundTruthAvailable: Boolean(groundTruthText?.trim()),
    environment,
    measurementNotes: [
      "模型按 runOrder 顺序逐个运行；elapsedMs 为该模型任务的有效转录耗时。",
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
  models: modelIds.map((modelId) => {
    const result = results[modelId];
    const variant = getVariant(record, modelId);
    const transcript = variant?.transcript ?? [];
    const elapsedMs = result?.elapsedMs ?? variant?.transcriptionElapsedMs;
    const transcriptionStats = result
      ? {
          ...variant?.transcriptionStats,
          processedAudioMs:
            result.processedAudioMs ?? variant?.transcriptionStats?.processedAudioMs,
          coveredAudioMs: result.coveredAudioMs ?? variant?.transcriptionStats?.coveredAudioMs,
          retryCount: result.retryCount ?? variant?.transcriptionStats?.retryCount,
          failedUnits: result.failedUnits ?? variant?.transcriptionStats?.failedUnits,
        }
      : variant?.transcriptionStats;
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
      status: result?.status ?? (variant ? "success" : "not_tested"),
      elapsedMs,
      elapsedSeconds: elapsedMs === undefined ? undefined : elapsedMs / 1_000,
      realTimeFactor:
        elapsedMs === undefined || measuredAudioMs === undefined || measuredAudioMs <= 0
          ? undefined
          : elapsedMs / measuredAudioMs,
      error: result?.message,
      model: variant?.model,
      pipelineVersion: variant?.pipelineVersion,
      updatedAt: variant?.updatedAt,
      transcriptionStats,
      timeBreakdown: {
        totalElapsedMs: elapsedMs,
        inferenceElapsedMs: transcriptionStats?.inferenceElapsedMs,
        conversionElapsedMs: transcriptionStats?.conversionElapsedMs,
        processedAudioMs: transcriptionStats?.processedAudioMs,
        coveredAudioMs: transcriptionStats?.coveredAudioMs,
      },
      processedAudioMs: transcriptionStats?.processedAudioMs,
      coveredAudioMs: transcriptionStats?.coveredAudioMs,
      coveragePercent:
        result?.coveragePercent ??
        (statsTotalAudioMs !== undefined &&
        statsCoveredAudioMs !== undefined &&
        statsTotalAudioMs > 0
          ? (statsCoveredAudioMs / statsTotalAudioMs) * 100
          : undefined),
      speakerCount: variant?.speakers.length ?? 0,
      speakers: variant?.speakers ?? [],
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

export const downloadModelComparisonExport = (
  payload: ReturnType<typeof buildModelComparisonExport>,
  fileName: string,
): void => {
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
