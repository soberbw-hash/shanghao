import {
  hasInvalidVoiceMemoryResult,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryRecord,
} from "@private-voice/shared";
import { isTranscriptionExecutionComplete } from "./remote-transcription";
import { automaticFusionFailure } from "./automatic-recording-recovery";
import type { AiAsrModelId } from "@private-voice/shared";

export function needsAutomaticCloudAssist(
  record: VoiceMemoryRecord,
  model?: { id: AiAsrModelId; ready: boolean },
): boolean {
  return Boolean(
    model?.ready &&
    record.phase === "ready" &&
    record.transcriptionModel?.id === "siliconflow-sensevoice-small" &&
    isTranscriptionExecutionComplete(record) &&
    !hasInvalidVoiceMemoryResult(record) &&
    (!record.transcriptionAssist ||
      (record.transcriptionAssist.status === "unavailable" &&
        record.transcriptionAssist.localModelId === model.id)),
  );
}

/** Existing permission may recover derived text, never another audio upload or an explicit pause. */
export function needsAutomaticPostprocessing(
  record: VoiceMemoryRecord,
  organize: boolean,
): boolean {
  return (
    organize &&
    record.autoOrganizeRequested === true &&
    canAutomaticallySummarize(record) &&
    ((!record.organization && !record.organizedAt && !record.summary.length) ||
      Boolean(automaticFusionFailure(record)))
  );
}

export function canAutomaticallySummarize(record: VoiceMemoryRecord): boolean {
  return (
    record.phase === "ready" &&
    record.taskStatus === "success" &&
    record.transcript.length > 0 &&
    !hasInvalidVoiceMemoryResult(record) &&
    isTranscriptionExecutionComplete(record)
  );
}
export function ownsAutomaticSummary(
  current: VoiceMemoryRecord | undefined,
  completed: VoiceMemoryRecord,
  taskId: string | undefined,
): boolean {
  return Boolean(
    current &&
    current.updatedAt === completed.updatedAt &&
    current.taskId === taskId &&
    current.phase === "ready" &&
    current.taskStatus === "success",
  );
}

/** Unknown legacy permission never grants automatic text-provider access. */
export const automaticOrganizationConsent = (
  previous: VoiceMemoryRecord | undefined,
  request: VoiceMemoryProcessRequest,
): boolean =>
  request.organize === true
    ? true
    : request.manual && typeof request.organize === "boolean"
      ? request.organize
      : previous
        ? previous.autoOrganizeRequested === true
        : false;

export const deferredVoiceMemoryRequest = (
  record: VoiceMemoryRecord,
  organizationEnabled: boolean,
): VoiceMemoryProcessRequest => ({
  recordingId: record.recordingId,
  filePath: record.filePath,
  roomId: record.roomId,
  roomName: record.roomName,
  transcribe: !isTranscriptionExecutionComplete(record),
  organize: record.autoOrganizeRequested === true && organizationEnabled,
});
