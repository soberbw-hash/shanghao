import {
  AI_ASR_MODEL_NAMES,
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

export const buildModelComparisonExport = ({
  recording,
  recordingTitle,
  audioDurationMs,
  record,
  modelIds,
  results,
}: ModelComparisonExportInput) => ({
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  purpose: "同一条录音的多模型转录原始对比数据；未在本地计算 CER。",
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
    return {
      modelId,
      modelName: modelDisplayName(modelId),
      status: result?.status ?? (variant ? "success" : "not_tested"),
      elapsedMs,
      elapsedSeconds: elapsedMs === undefined ? undefined : elapsedMs / 1_000,
      realTimeFactor:
        elapsedMs === undefined || audioDurationMs === undefined || audioDurationMs <= 0
          ? undefined
          : elapsedMs / audioDurationMs,
      error: result?.message,
      model: variant?.model,
      pipelineVersion: variant?.pipelineVersion,
      updatedAt: variant?.updatedAt,
      speakerCount: variant?.speakers.length ?? 0,
      speakers: variant?.speakers ?? [],
      text: transcript.map((segment) => segment.text).join("\n"),
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
