import {
  AI_ASR_MODEL_NAMES,
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  type AiAsrModelId,
  type AiAsrRuntimeStatus,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptionModel,
  type VoiceMemoryBenchmarkRunMetadata,
} from "@private-voice/shared";
import type { AiModelManager } from "./ai-model-manager";
import type { AiRuntimeManager } from "./ai-runtime-manager";
import { TRANSCRIPTION_CHUNK_MS } from "./asr-chunk-policy";
import { probeRecordingMedia } from "./recording-media-probe";
import { loadRecordingSpeakerSegments } from "./recording-speaker-segments";
import { loadRecordingParticipantTracks } from "./recording-participant-tracks";
import {
  splitParticipantTracksIntoSpeakerSources,
  type KnownSpeakerTranscriptionSource,
} from "./speaker-transcript";
export const AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS = 30 * 60_000;
export const benchmarkDurationForMode = (
  mode: "smoke" | "standard" | "long" | undefined,
  sourceDurationMs: number,
): number =>
  Math.min(
    sourceDurationMs,
    mode === "smoke" ? 3 * 60_000 : mode === "standard" ? 10 * 60_000 : sourceDurationMs,
  );

export const benchmarkRangeForMode = (
  mode: "smoke" | "standard" | "long" | undefined,
  sourceDurationMs: number,
): { sourceStartMs: number; sourceEndMs: number; clipDurationMs: number } => {
  const clipDurationMs = benchmarkDurationForMode(mode, sourceDurationMs);
  const sourceStartMs =
    mode === "standard" && clipDurationMs < sourceDurationMs
      ? Math.max(0, Math.floor((sourceDurationMs - clipDurationMs) / 2))
      : 0;
  return {
    sourceStartMs,
    sourceEndMs: sourceStartMs + clipDurationMs,
    clipDurationMs,
  };
};

export const resolveTranscriptionRunRange = (
  sourceDurationMs: number,
  benchmark: VoiceMemoryBenchmarkRunMetadata | undefined,
): { sourceStartMs: number; sourceEndMs: number; clipDurationMs: number } => {
  if (!benchmark) return benchmarkRangeForMode(undefined, sourceDurationMs);
  const savedClip = benchmark.clips?.[0];
  const fallback = benchmarkRangeForMode(benchmark.mode, sourceDurationMs);
  const sourceStartMs = Math.max(
    0,
    Math.min(
      sourceDurationMs,
      savedClip ? (savedClip.sourceStartMs ?? savedClip.startMs) : fallback.sourceStartMs,
    ),
  );
  const sourceEndMs = Math.max(
    sourceStartMs,
    Math.min(
      sourceDurationMs,
      savedClip?.sourceEndMs ??
        sourceStartMs +
          (savedClip ? Math.max(0, savedClip.endMs - savedClip.startMs) : fallback.clipDurationMs),
    ),
  );
  return { sourceStartMs, sourceEndMs, clipDurationMs: sourceEndMs - sourceStartMs };
};
const LEGACY_TRANSCRIPTION_CHUNK_MS = 10 * 60_000;
// Version 8 binds speaker identity to independent participant streams. Partial mixed-stream
// results must never be merged into this speaker-aware pipeline.
export const canAutomaticallyTranscribeDuration = (durationMs: number): boolean =>
  durationMs <= AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS;

export const isRecoverableFfmpegFailure = (record: VoiceMemoryRecord): boolean =>
  record.phase === "error" &&
  (record.errorMessage === "ffmpeg_missing" || record.diagnostic?.errorCode === "ffmpeg_missing");

export const transcriptionModelMetadata = (
  modelId: AiAsrModelId,
  status: AiAsrRuntimeStatus,
): VoiceMemoryTranscriptionModel => ({
  id: modelId,
  name: status.modelName?.trim() || AI_ASR_MODEL_NAMES[modelId],
  ...(status.modelVersion?.trim() ? { version: status.modelVersion.trim() } : {}),
});

export const completedTranscriptionUnits = (
  checkpoint: { completedUnits: number; unitDurationMs?: number } | undefined,
  totalUnits: number,
  currentUnitDurationMs = TRANSCRIPTION_CHUNK_MS,
): number =>
  Math.min(
    totalUnits,
    Math.floor(
      ((checkpoint?.completedUnits ?? 0) *
        (checkpoint?.unitDurationMs ?? LEGACY_TRANSCRIPTION_CHUNK_MS)) /
        currentUnitDurationMs,
    ),
  );

/** Resolves the pinned model and probes media; never owns jobs or writes checkpoints. */
export async function prepareTranscriptionInput(
  models: Pick<AiModelManager, "getActiveAsrModel" | "getTaskCheckpoint" | "canRunTask">,
  runtime: Pick<AiRuntimeManager, "status">,
  record: VoiceMemoryRecord,
  manual: boolean,
  signal: AbortSignal,
  requestedModelId?: AiAsrModelId,
) {
  if (signal.aborted) throw new Error("ai_task_paused");
  const selectedModelId =
    requestedModelId ?? record.transcriptionModel?.id ?? models.getActiveAsrModel();
  const taskId = `transcription:${record.recordingId}:${selectedModelId}`;
  const legacyTaskId = `transcription:${record.recordingId}`;
  const modelCheckpoint = models.getTaskCheckpoint(taskId);
  const legacyCheckpoint = models.getTaskCheckpoint(legacyTaskId);
  const checkpoint =
    modelCheckpoint ??
    (legacyCheckpoint?.asrModelId === selectedModelId ? legacyCheckpoint : undefined);
  const checkpointModel =
    checkpoint?.pipelineVersion === CURRENT_TRANSCRIPTION_PIPELINE_VERSION
      ? checkpoint.asrModelId
      : undefined;
  // "Continue transcription" belongs to the recording, not to the model currently selected
  // in Settings. Pin a valid checkpoint to its original ASR so changing the default model does
  // not restart the recording or mix two recognizers in one transcript.
  const runnable = models.canRunTask("transcription", manual, checkpointModel ?? selectedModelId);
  if (!runnable.runnable) throw new Error(runnable.reason);
  const asrModelId = runnable.requiredModel as AiAsrModelId;
  const asrStatus = (await runtime.status(asrModelId)).asr;
  const transcriptionModel = transcriptionModelMetadata(asrModelId, asrStatus);
  const audio = await probeRecordingMedia(record.filePath, { signal });

  if (signal.aborted) throw new Error("ai_task_paused");
  return {
    taskId,
    legacyTaskId,
    legacyCheckpoint,
    checkpoint,
    runnable,
    asrModelId,
    asrStatus,
    transcriptionModel,
    audio,
  };
}

/** Keeps existing unit identities stable when resuming legacy participant-track checkpoints. */
export async function prepareKnownSpeakerSources(
  record: VoiceMemoryRecord,
  asrModelId: AiAsrModelId,
  checkpoint: ReturnType<AiModelManager["getTaskCheckpoint"]>,
  sourceStartMs: number,
  sourceEndMs: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new Error("ai_task_paused");
  // Prefer speech-only clips carrying the signed-in participant identity. A twelve-hour room
  // may contain far less than twelve hours of actual speech, so this avoids repeatedly decoding
  // every participant's silence while retaining exact nicknames and overlapping speakers.
  const loadedSpeakerSegments = await loadRecordingSpeakerSegments(
    record.recordingId,
    record.filePath,
  );
  const speechSources: KnownSpeakerTranscriptionSource[] = (loadedSpeakerSegments ?? [])
    .filter((segment) => segment.startMs < sourceEndMs && segment.endMs > sourceStartMs)
    .map((segment) => {
      const clippedStartMs = Math.max(segment.startMs, sourceStartMs);
      return {
        ...segment,
        speakerId: segment.userId?.trim() || segment.speakerId,
        startMs: clippedStartMs,
        endMs: Math.min(segment.endMs, sourceEndMs),
        audioOffsetMs: Math.max(0, clippedStartMs - segment.startMs),
      };
    });
  const participantTracks = await loadRecordingParticipantTracks(
    record.recordingId,
    record.filePath,
  );
  const participantSources = participantTracks?.length
    ? splitParticipantTracksIntoSpeakerSources(
        participantTracks,
        sourceEndMs,
        TRANSCRIPTION_CHUNK_MS,
        sourceStartMs,
      )
    : [];
  const durableSourceUnits = (record.transcriptionUnits ?? []).filter(
    (unit) =>
      unit.modelId === asrModelId &&
      unit.pipelineVersion === CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  );
  const durableUnitsMatch = (sources: KnownSpeakerTranscriptionSource[]): boolean =>
    durableSourceUnits.length === sources.length &&
    durableSourceUnits.every((unit, index) => {
      const source = sources[index];
      return (
        source !== undefined &&
        unit.startMs === source.startMs &&
        unit.endMs === source.endMs &&
        unit.speakerId === source.speakerId
      );
    });
  // An interrupted recording created by an older build may already have checkpoints against
  // the continuous participant tracks. Finish those exact saved units instead of silently
  // changing the unit timeline mid-run; all fresh work uses the smaller speech-only source.
  const resumeParticipantSources =
    participantSources.length > 0 &&
    ((durableSourceUnits.length > 0 &&
      durableUnitsMatch(participantSources) &&
      !durableUnitsMatch(speechSources)) ||
      (durableSourceUnits.length === 0 &&
        checkpoint?.pipelineVersion === CURRENT_TRANSCRIPTION_PIPELINE_VERSION &&
        checkpoint.asrModelId === asrModelId &&
        checkpoint.totalUnits === participantSources.length &&
        checkpoint.totalUnits !== speechSources.length));
  const knownSpeakerSegments: KnownSpeakerTranscriptionSource[] = resumeParticipantSources
    ? participantSources
    : speechSources.length
      ? speechSources
      : participantSources;

  if (signal.aborted) throw new Error("ai_task_paused");
  return { knownSpeakerSegments, resumeParticipantSources, speechSources };
}
