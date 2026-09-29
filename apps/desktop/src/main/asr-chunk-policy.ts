import type { AiAsrModelId, VoiceMemoryTranscriptionUnit } from "@private-voice/shared";

// Short units bound inference memory and preserve useful seek points.
export const TRANSCRIPTION_CHUNK_MS = 30_000;
export const MOSS_CPP_TRANSCRIPTION_CHUNK_MS = 30_000;
const LEGACY_MOSS_CPP_TRANSCRIPTION_CHUNK_MS = 10 * 60_000;

export const mossTranscriptionChunkMsForResume = (
  checkpoint: { unitDurationMs?: number } | undefined,
  priorUnits: readonly Pick<VoiceMemoryTranscriptionUnit, "startMs" | "endMs">[] = [],
): number =>
  checkpoint?.unitDurationMs === LEGACY_MOSS_CPP_TRANSCRIPTION_CHUNK_MS ||
  priorUnits.some((unit) => unit.endMs - unit.startMs > MOSS_CPP_TRANSCRIPTION_CHUNK_MS)
    ? LEGACY_MOSS_CPP_TRANSCRIPTION_CHUNK_MS
    : MOSS_CPP_TRANSCRIPTION_CHUNK_MS;

export const transcriptionChunkMsForModel = (
  modelId: AiAsrModelId,
  pipelineVersion: number,
  checkpoint:
    { asrModelId?: AiAsrModelId; pipelineVersion?: number; unitDurationMs?: number } | undefined,
  units: readonly Pick<
    VoiceMemoryTranscriptionUnit,
    "modelId" | "pipelineVersion" | "startMs" | "endMs"
  >[] = [],
): number => {
  if (modelId !== "moss-transcribe-diarize-0.9b-q8_0") return TRANSCRIPTION_CHUNK_MS;
  const matchingCheckpoint =
    checkpoint?.asrModelId === modelId && checkpoint.pipelineVersion === pipelineVersion
      ? checkpoint
      : undefined;
  const priorUnits = units.filter(
    (unit) => unit.modelId === modelId && unit.pipelineVersion === pipelineVersion,
  );
  return mossTranscriptionChunkMsForResume(matchingCheckpoint, priorUnits);
};
