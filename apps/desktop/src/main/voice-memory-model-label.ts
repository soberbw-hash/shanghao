import {
  AI_ASR_MODEL_NAMES,
  type AiAsrModelId,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

export function withTranscriptionModelLabel(
  record: VoiceMemoryRecord,
  checkpointModelId: () => NonNullable<VoiceMemoryRecord["transcriptionModel"]>["id"] | undefined,
): VoiceMemoryRecord {
  if (record.transcriptionModel || record.transcript.length === 0) return record;
  const modelId =
    Object.values(record.transcriptionVariants ?? {})[0]?.model.id ?? checkpointModelId();
  return modelId
    ? {
        ...record,
        transcriptionModel: {
          id: modelId,
          name: AI_ASR_MODEL_NAMES[modelId as AiAsrModelId] ?? modelId,
        },
      }
    : record;
}
