import type {
  VoiceMemoryRecord,
  VoiceMemorySpeaker,
  VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";
import { transcriptFusionSignature } from "./transcript-fusion";

function refreshFusion(record: VoiceMemoryRecord): VoiceMemoryRecord {
  if (!record.transcriptionFusion) return record;
  const signature = transcriptFusionSignature(record);
  return {
    ...record,
    transcriptionFusion: signature
      ? { ...record.transcriptionFusion, sourceSignature: signature }
      : undefined,
  };
}

/** Human confirmation updates the corresponding ASR namespace and corrected copy, never timing/text. */
export function assignVoiceMemorySpeaker(
  record: VoiceMemoryRecord,
  speakerId: string,
  memberId: string,
  nickname: string,
): VoiceMemoryRecord {
  const bind = (segment: VoiceMemoryTranscriptSegment, targetId = speakerId) =>
    segment.speakerId === targetId
      ? { ...segment, memberId, nickname, confidence: "high" as const }
      : segment;
  const speakers = (items: VoiceMemorySpeaker[], targetId = speakerId) => [
    ...items.filter((s) => s.speakerId !== targetId),
    {
      speakerId: targetId,
      memberId,
      nickname,
      confidence: "high" as const,
      manuallyConfirmed: true,
    },
  ];
  const transcriptionVariants = Object.fromEntries(
    Object.entries(record.transcriptionVariants ?? {}).map(([id, variant]) => [
      id,
      variant && id === record.transcriptionModel?.id
        ? {
            ...variant,
            speakers: speakers(variant.speakers),
            transcript: variant.transcript.map((segment) => bind(segment)),
          }
        : variant,
    ]),
  );
  const fusion = record.transcriptionFusion;
  const localIdentity = record.transcriptionModel?.id === record.transcriptionAssist?.localModelId;
  const fusionTargetId = localIdentity
    ? speakerId
    : fusion?.transcript.some((s) => s.fusionEstimated && s.speakerId === speakerId) &&
        !fusion.transcript.some(
          (s) => s.fusionEstimated && s.speakerId === `fusion-cloud:${speakerId}`,
        )
      ? speakerId
      : `fusion-cloud:${speakerId}`;
  return refreshFusion({
    ...record,
    speakers: speakers(record.speakers),
    transcript: record.transcript.map((segment) => bind(segment)),
    transcriptionVariants,
    transcriptionFusion: fusion
      ? {
          ...fusion,
          speakers: speakers(fusion.speakers, fusionTargetId),
          transcript: fusion.transcript.map((segment) => bind(segment, fusionTargetId)),
        }
      : undefined,
  });
}

/** Called only for the trusted native catalog's migration of this same audio to its stable ID. */
export function migrateVoiceMemoryIdentity(
  record: VoiceMemoryRecord,
  recordingId: string,
  filePath: string,
): VoiceMemoryRecord {
  const migrate = (segment: VoiceMemoryTranscriptSegment) =>
    segment.recordingId === record.recordingId ? { ...segment, recordingId } : segment;
  return refreshFusion({
    ...record,
    recordingId,
    filePath,
    transcript: record.transcript.map(migrate),
    transcriptionVariants: Object.fromEntries(
      Object.entries(record.transcriptionVariants ?? {}).map(([id, variant]) => [
        id,
        variant ? { ...variant, transcript: variant.transcript.map(migrate) } : variant,
      ]),
    ),
    transcriptionFusion: record.transcriptionFusion
      ? {
          ...record.transcriptionFusion,
          transcript: record.transcriptionFusion.transcript.map(migrate),
        }
      : undefined,
  });
}
