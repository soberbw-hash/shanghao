import type { AppSettings, VoiceMemoryRecord } from "@private-voice/shared";
import { publishVoiceMemoryOrganization } from "./recording-recap-publisher";

type UploadDependencies = Parameters<typeof publishVoiceMemoryOrganization>[0];

/** Publication is always an explicit action; old automatic-upload preferences are ignored. */
export const createRecordingRecapUpload = (
  dependencies: Omit<UploadDependencies, "recordingId" | "automatic">,
  _legacySettings: () => Pick<AppSettings, "isAiAutoUploadEnabled">,
) => {
  const pending = new Map<string, Promise<VoiceMemoryRecord>>();
  const upload = (recordingId: string, automatic = false): Promise<VoiceMemoryRecord> => {
    if (automatic)
      return dependencies.voiceMemory.get(recordingId).then((record) => {
        if (!record) throw new Error("voice_memory_organization_required");
        return record;
      });
    const existing = pending.get(recordingId);
    if (existing) return existing;
    const task = Promise.resolve()
      .then(async () => {
        return publishVoiceMemoryOrganization({ ...dependencies, recordingId, automatic });
      })
      .finally(() => pending.delete(recordingId));
    pending.set(recordingId, task);
    return task;
  };
  return {
    upload,
    onCompleted(_record: VoiceMemoryRecord) {},
  };
};
