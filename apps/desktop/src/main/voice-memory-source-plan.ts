import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  type AiAsrModelId,
  type VoiceMemoryTranscriptionUnit,
} from "@private-voice/shared";
import {
  includeParticipantsMissingSpeechClips,
  type KnownSpeakerTranscriptionSource,
} from "./speaker-transcript";
import type { PersistedRecordingSpeakerSegment } from "./recording-speaker-segments";

export function assertRecordingSourceRooms(
  roomId: string | undefined,
  speech: readonly { roomId?: string }[] | undefined,
  participants: readonly { roomId?: string }[] | undefined,
): void {
  if (!roomId) return;
  if (speech?.some((source) => source.roomId && source.roomId !== roomId))
    throw new Error("speaker_segment_room_mismatch");
  if (participants?.some((source) => source.roomId && source.roomId !== roomId))
    throw new Error("participant_track_room_mismatch");
}

export const clippedSpeechSources = (
  segments: readonly PersistedRecordingSpeakerSegment[] | undefined,
  sourceStartMs: number,
  sourceEndMs: number,
): KnownSpeakerTranscriptionSource[] =>
  (segments ?? [])
    .filter((segment) => segment.startMs < sourceEndMs && segment.endMs > sourceStartMs)
    .map((segment) => {
      const clippedStartMs = Math.max(segment.startMs, sourceStartMs);
      return {
        ...segment,
        speakerId: segment.userId?.trim() || segment.speakerId,
        accountIdentity: segment.userId?.trim() || undefined,
        startMs: clippedStartMs,
        endMs: Math.min(segment.endMs, sourceEndMs),
        audioOffsetMs: Math.max(0, clippedStartMs - segment.startMs),
      };
    });

/** Count alone cannot prove that a saved checkpoint belongs to the same speaker timeline. */
export const durableUnitsMatchDefinitions = (
  definitions: readonly { index: number; startMs: number; endMs: number; speakerId?: string }[],
  units: readonly VoiceMemoryTranscriptionUnit[] | undefined,
): boolean =>
  Boolean(
    units &&
    units.length === definitions.length &&
    units.every((unit, index) => {
      const definition = definitions[index];
      return (
        definition &&
        unit.index === definition.index &&
        unit.startMs === definition.startMs &&
        unit.endMs === definition.endMs &&
        unit.speakerId === definition.speakerId
      );
    }),
  );

/** Preserve the exact unit plan of older checkpoints before adding new track coverage. */
export function selectSpeakerSourcesForResume(
  speechSources: KnownSpeakerTranscriptionSource[],
  participantSources: KnownSpeakerTranscriptionSource[],
  durableUnits: ReadonlyArray<{ startMs: number; endMs: number; speakerId?: string }>,
  checkpoint:
    { pipelineVersion?: number; asrModelId?: AiAsrModelId; totalUnits: number } | undefined,
  asrModelId: AiAsrModelId,
) {
  const combined = includeParticipantsMissingSpeechClips(speechSources, participantSources);
  const candidateSignatures = new Set(
    [speechSources, participantSources, combined]
      .filter((sources) => sources.length > 0 && sources.length === checkpoint?.totalUnits)
      .map((sources) =>
        JSON.stringify(
          sources.map((source) => [
            source.filePath,
            source.audioOffsetMs,
            source.startMs,
            source.endMs,
            source.speakerId,
          ]),
        ),
      ),
  );
  const matches = (sources: KnownSpeakerTranscriptionSource[]) =>
    durableUnits.length === sources.length &&
    durableUnits.every((unit, index) => {
      const source = sources[index];
      return (
        source &&
        unit.startMs === source.startMs &&
        unit.endMs === source.endMs &&
        unit.speakerId === source.speakerId
      );
    });
  const matchingDurableSignatures = new Set(
    [speechSources, participantSources, combined]
      .filter((sources) => sources.length > 0 && matches(sources))
      .map((sources) =>
        JSON.stringify(sources.map((source) => [source.filePath, source.audioOffsetMs])),
      ),
  );
  const compatible =
    checkpoint?.pipelineVersion === CURRENT_TRANSCRIPTION_PIPELINE_VERSION &&
    checkpoint.asrModelId === asrModelId;
  const resumeParticipantSources =
    participantSources.length > 0 &&
    ((durableUnits.length > 0 && matches(participantSources) && !matches(speechSources)) ||
      (durableUnits.length === 0 &&
        compatible &&
        checkpoint?.totalUnits === participantSources.length &&
        checkpoint.totalUnits !== speechSources.length));
  const resumeSpeechSources =
    speechSources.length > 0 &&
    ((durableUnits.length > 0 && matches(speechSources)) ||
      (durableUnits.length === 0 &&
        compatible &&
        checkpoint?.totalUnits === speechSources.length &&
        checkpoint.totalUnits !== combined.length));
  return {
    knownSpeakerSegments: resumeParticipantSources
      ? participantSources
      : resumeSpeechSources
        ? speechSources
        : combined,
    resumeParticipantSources,
    /** Old units omit file identity; equal times and speakers can still name different audio. */
    ambiguousLegacyPlan:
      (durableUnits.length === 0 && candidateSignatures.size > 1) ||
      matchingDurableSignatures.size > 1,
  };
}
