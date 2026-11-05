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
import { verifySource } from "./voice-memory-source-integrity";

export type FingerprintMatchedSourcePlan = "speech" | "participant" | "combined";

/** Resolve identical time/speaker plans only when a completed checkpoint proves file identity. */
export async function findFingerprintMatchedSourcePlan(
  speechSources: KnownSpeakerTranscriptionSource[],
  participantSources: KnownSpeakerTranscriptionSource[],
  durableUnits: ReadonlyArray<{
    startMs: number;
    endMs: number;
    speakerId?: string;
    status: string;
    sourceFingerprint?: string;
  }>,
): Promise<FingerprintMatchedSourcePlan | undefined> {
  const combined = includeParticipantsMissingSpeechClips(speechSources, participantSources);
  const candidates: Array<{
    plan: FingerprintMatchedSourcePlan;
    sources: KnownSpeakerTranscriptionSource[];
  }> = [
    { plan: "speech", sources: speechSources },
    { plan: "participant", sources: participantSources },
    { plan: "combined", sources: combined },
  ];
  const completed = durableUnits.filter((unit) => unit.status === "completed");
  if (!completed.length || completed.some((unit) => !unit.sourceFingerprint)) return undefined;

  const matching = new Map<string, FingerprintMatchedSourcePlan>();
  for (const candidate of candidates) {
    if (candidate.sources.length !== durableUnits.length) continue;
    const timelineMatches = durableUnits.every((unit, index) => {
      const source = candidate.sources[index];
      return (
        source &&
        unit.startMs === source.startMs &&
        unit.endMs === source.endMs &&
        unit.speakerId === source.speakerId
      );
    });
    if (!timelineMatches) continue;
    let fingerprintsMatch = true;
    for (let index = 0; index < durableUnits.length; index++) {
      const unit = durableUnits[index];
      const source = candidate.sources[index];
      if (unit?.status !== "completed" || !unit.sourceFingerprint || !source) continue;
      try {
        await verifySource(source, unit.sourceFingerprint);
      } catch {
        fingerprintsMatch = false;
        break;
      }
    }
    if (!fingerprintsMatch) continue;
    const signature = JSON.stringify(
      candidate.sources.map((source) => [source.filePath, source.audioOffsetMs]),
    );
    if (!matching.has(signature)) matching.set(signature, candidate.plan);
  }
  return matching.size === 1 ? matching.values().next().value : undefined;
}

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
  fingerprintMatchedPlan?: FingerprintMatchedSourcePlan,
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
  const fingerprintedSources =
    fingerprintMatchedPlan === "speech"
      ? speechSources
      : fingerprintMatchedPlan === "participant"
        ? participantSources
        : fingerprintMatchedPlan === "combined"
          ? combined
          : undefined;
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
    knownSpeakerSegments:
      fingerprintedSources ??
      (resumeParticipantSources
        ? participantSources
        : resumeSpeechSources
          ? speechSources
          : combined),
    resumeParticipantSources: fingerprintedSources
      ? fingerprintMatchedPlan === "participant"
      : resumeParticipantSources,
    /** Old units omit file identity; equal times and speakers can still name different audio. */
    ambiguousLegacyPlan:
      !fingerprintedSources &&
      ((durableUnits.length === 0 && candidateSignatures.size > 1) ||
        matchingDurableSignatures.size > 1),
  };
}
