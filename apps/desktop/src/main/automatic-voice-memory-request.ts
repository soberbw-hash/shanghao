import {
  hasInvalidVoiceMemoryResult,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryRecord,
} from "@private-voice/shared";
import { isTranscriptionExecutionComplete } from "./remote-transcription";
import { automaticFusionFailure } from "./automatic-recording-recovery";
import type { AiAsrModelId } from "@private-voice/shared";
import type { AiModelManager } from "./ai-model-manager";
import { RECORDING_ORGANIZATION_PIPELINE_VERSION } from "./recording-organizer";

export function automaticCloudAssistModel(
  models: AiModelManager,
  enabled: boolean,
  id: AiAsrModelId,
) {
  if (!enabled) return;
  const model = models.getSnapshot().models.find((item) => item.id === id);
  if (!model?.activeRevision || model.userInstalled === false || model.phase === "paused") return;
  return {
    id,
    ready: model.runtimeReady && models.canRunTask("transcription", false, id).runnable,
  };
}

const recoverableAssistInterruption = (reason = "") =>
  /^(?:recording_priority|realtime_pressure|waiting_for_game_to_finish|manual_only|memory_pressure|cpu_pressure|voice_[a-z_]+|screen_share[a-z_]*|peer_recovery[a-z_]*|network_quality[a-z_]*|renderer_memory[a-z_]*)$/.test(
    reason,
  );

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
      ((record.transcriptionAssist.status === "unavailable" ||
        (record.transcriptionAssist.status === "failed" &&
          recoverableAssistInterruption(record.transcriptionAssist.errorCode))) &&
        record.transcriptionAssist.localModelId === model.id)),
  );
}

export function automaticCloudAssistRetryState(
  record: VoiceMemoryRecord,
  model?: { id: AiAsrModelId; ready: boolean },
) {
  if (!model || !needsAutomaticCloudAssist(record, { ...model, ready: true })) return;
  return model.ready ? ("ready" as const) : ("waiting" as const);
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
      (record.organization?.status === "completed" &&
        record.organization.pipelineVersion < RECORDING_ORGANIZATION_PIPELINE_VERSION) ||
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
  assistModel?: { id: AiAsrModelId; ready: boolean },
): VoiceMemoryProcessRequest => ({
  recordingId: record.recordingId,
  filePath: record.filePath,
  roomId: record.roomId,
  roomName: record.roomName,
  transcribe:
    needsAutomaticCloudAssist(record, assistModel) || !isTranscriptionExecutionComplete(record),
  organize: record.autoOrganizeRequested === true && organizationEnabled,
});
