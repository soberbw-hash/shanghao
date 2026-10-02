import type { VoiceMemoryRecord, VoiceMemoryOrganizationPublication } from "@private-voice/shared";
import type { VoiceMemorySaveOptions } from "./voice-memory-store";

/** Validate result ownership before the store's atomic publication-only commit. */
export const markVoiceMemoryPublication = async (
  recordingId: string,
  publication: VoiceMemoryOrganizationPublication,
  organizedAt: string | undefined,
  read: (id: string) => Promise<VoiceMemoryRecord>,
  save: (record: VoiceMemoryRecord, options: VoiceMemorySaveOptions) => Promise<VoiceMemoryRecord>,
): Promise<VoiceMemoryRecord> => {
  const record = await read(recordingId);
  if (
    record.phase !== "ready" ||
    record.organization?.status !== "completed" ||
    !record.organization.finalResult ||
    record.roomId !== publication.roomId ||
    (organizedAt && record.organizedAt !== organizedAt)
  )
    throw new Error("recording_recap_result_changed");
  return save(
    { ...record, organizationPublication: publication },
    {
      publicationFor: { roomId: record.roomId, organizedAt: record.organizedAt },
    },
  );
};
