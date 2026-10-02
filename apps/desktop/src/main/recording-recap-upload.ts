import type { AppSettings, VoiceMemoryRecord } from "@private-voice/shared";
import { publishVoiceMemoryOrganization } from "./recording-recap-publisher";

type UploadDependencies = Parameters<typeof publishVoiceMemoryOrganization>[0];

/** One upload per recording, with opt-in evaluated at completion and before sending. */
export const createRecordingRecapUpload = (
  dependencies: Omit<UploadDependencies, "recordingId" | "automatic">,
  getSettings: () => Pick<AppSettings, "isAiAutoUploadEnabled">,
) => {
  const pending = new Map<string, Promise<VoiceMemoryRecord>>();
  const upload = (recordingId: string, automatic = false): Promise<VoiceMemoryRecord> => {
    const existing = pending.get(recordingId);
    if (existing) return existing;
    const task = Promise.resolve()
      .then(async () => {
        if (automatic && getSettings().isAiAutoUploadEnabled !== true) {
          const record = await dependencies.voiceMemory.get(recordingId);
          if (!record) throw new Error("voice_memory_organization_required");
          return record;
        }
        return publishVoiceMemoryOrganization({ ...dependencies, recordingId, automatic });
      })
      .finally(() => pending.delete(recordingId));
    pending.set(recordingId, task);
    return task;
  };
  return {
    upload,
    onCompleted(record: VoiceMemoryRecord) {
      if (
        getSettings().isAiAutoUploadEnabled !== true ||
        record.phase !== "ready" ||
        record.organization?.status !== "completed" ||
        record.organizationPublication ||
        record.taskId?.startsWith("model-comparison:")
      )
        return;
      void upload(record.recordingId, true).catch(() => undefined);
    },
  };
};
