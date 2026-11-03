import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  VoiceMemoryProcessRequest,
  VoiceMemoryTaskStatus,
  VoiceMemoryProcessingStage,
  VoiceMemoryTaskDiagnostic,
} from "@private-voice/shared";

export const createTaskId = (recordingId: string): string =>
  `voice-memory:${recordingId}:${Date.now()}-${randomUUID().slice(0, 8)}`;

export function createDiagnostic(
  request: Pick<VoiceMemoryProcessRequest, "recordingId" | "filePath" | "taskId">,
  status: VoiceMemoryTaskStatus,
  stage: VoiceMemoryProcessingStage,
  patch?: Partial<VoiceMemoryTaskDiagnostic>,
): VoiceMemoryTaskDiagnostic {
  return {
    taskId: request.taskId ?? createTaskId(request.recordingId),
    status,
    stage,
    fileName: path.basename(request.filePath),
    updatedAt: new Date().toISOString(),
    ...patch,
  };
}
