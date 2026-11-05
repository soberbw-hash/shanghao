import { randomUUID } from "node:crypto";
import type { VoiceMemoryRecord } from "@private-voice/shared";

/** Preserve a user-visible copy before replacing or invalidating the active fusion. */
export function archiveFusion(record: VoiceMemoryRecord): VoiceMemoryRecord {
  const fusion = record.transcriptionFusion;
  if (!fusion?.transcript.length) return { ...record, transcriptionFusion: undefined };
  return {
    ...record,
    transcriptionFusion: undefined,
    transcriptionFusionHistory: [
      ...(record.transcriptionFusionHistory ?? []),
      { id: randomUUID(), archivedAt: new Date().toISOString(), fusion },
    ],
  };
}
