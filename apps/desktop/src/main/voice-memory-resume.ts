import {
  AI_ASR_MODEL_NAMES,
  hasInvalidVoiceMemoryResult,
  type AiAsrModelId,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryRecord,
} from "@private-voice/shared";
import { isTranscriptionExecutionComplete } from "./remote-transcription";

/** A resume belongs to the persisted task/model, never a later global preference. */
export function voiceMemoryResumeRequest(record: VoiceMemoryRecord): VoiceMemoryProcessRequest {
  const organize =
    record.processingStage === "organize" &&
    record.transcript.length > 0 &&
    !hasInvalidVoiceMemoryResult(record);
  const fusing = record.transcriptionFusion?.status === "running";
  return {
    recordingId: record.recordingId,
    filePath: record.filePath,
    roomId: record.roomId,
    roomName: record.roomName,
    manual: true,
    transcribe: !organize && !isTranscriptionExecutionComplete(record),
    organize: (!fusing && organize) || record.autoOrganizeRequested === true,
    ...(fusing ? { fuse: true } : {}),
    asrModelId:
      record.transcriptionModel?.id && record.transcriptionModel.id in AI_ASR_MODEL_NAMES
        ? (record.transcriptionModel.id as AiAsrModelId)
        : undefined,
  };
}
