import { randomUUID } from "node:crypto";
import type { VoiceMemoryRecord } from "@private-voice/shared";

/** Snapshot every saved model and the active text before a user-requested restart. */
export function archiveTranscriptionOriginals(record: VoiceMemoryRecord): VoiceMemoryRecord {
  const archivedAt = new Date().toISOString();
  const history = [...(record.transcriptionOriginalHistory ?? [])];
  for (const variant of Object.values(record.transcriptionVariants ?? {})) {
    if (!variant?.transcript.length) continue;
    history.push({
      id: randomUUID(),
      archivedAt,
      model: variant.model,
      transcript: variant.transcript,
      speakers: variant.speakers,
    });
  }
  if (record.transcript.length)
    history.push({
      id: randomUUID(),
      archivedAt,
      model: record.transcriptionModel,
      transcript: record.transcript,
      speakers: record.speakers,
    });
  return { ...record, transcriptionOriginalHistory: history.length ? history : undefined };
}
