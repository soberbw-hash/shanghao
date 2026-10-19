import type { VoiceMemoryProcessRequest, VoiceMemoryRecord } from "@private-voice/shared";
import { isTranscriptionExecutionComplete } from "./remote-transcription";

/** Unknown legacy permission never grants automatic text-provider access. */
export const automaticOrganizationConsent = (
  previous: VoiceMemoryRecord | undefined,
  request: VoiceMemoryProcessRequest,
): boolean =>
  request.manual && typeof request.organize === "boolean"
    ? request.organize
    : previous
      ? previous.autoOrganizeRequested === true
      : request.organize === true;

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
