import { createHash } from "node:crypto";
import path from "node:path";
import type { RecordingLibrarySnapshot, VoiceMemoryRecord } from "@private-voice/shared";
import type { AiVoiceMemoryService } from "./ai-voice-memory-service";

const normalizedPath = (value: string): string =>
  /^[a-z]:[\\/]|^\\\\/i.test(value)
    ? path.win32.resolve(value).toLocaleLowerCase("en-US")
    : path.resolve(value);

/** Legacy records lack a content hash: missing or contradictory metadata never grants identity. */
export function canRecoverLegacyRecording(
  record: VoiceMemoryRecord,
  item: { filePath: string; createdAt?: string; modifiedAt?: string; roomId?: string },
): boolean {
  const originalPath = normalizedPath(record.filePath);
  const legacyId =
    normalizedPath(record.recordingId) === originalPath ||
    record.recordingId === createHash("sha256").update(originalPath).digest("hex");
  const recordedAt = Date.parse(record.recordedAt ?? ""),
    catalogAt = Date.parse(item.createdAt ?? "");
  const modifiedAt = Date.parse(item.modifiedAt ?? ""),
    processedAt = Date.parse(record.createdAt);
  return (
    legacyId &&
    originalPath === normalizedPath(item.filePath) &&
    [recordedAt, catalogAt, modifiedAt, processedAt].every(Number.isFinite) &&
    recordedAt === catalogAt &&
    modifiedAt <= processedAt &&
    (!item.roomId || !record.roomId || item.roomId === record.roomId)
  );
}

/** Called only after Main reads its trusted native catalog; this never schedules inference. */
export async function reconcileRecordingMemories(
  snapshot: RecordingLibrarySnapshot,
  memories: Pick<AiVoiceMemoryService, "get" | "listSummaries" | "reconcileRecordingIdentity">,
): Promise<RecordingLibrarySnapshot> {
  const summaries = await memories.listSummaries();
  const stableIds = new Set(summaries.map((record) => record.recordingId));
  const byPath = new Map<string, typeof summaries>();
  for (const summary of summaries) {
    const key = normalizedPath(summary.filePath),
      group = byPath.get(key) ?? [];
    group.push(summary);
    byPath.set(key, group);
  }
  const items = [];
  for (const item of snapshot.items) {
    if (stableIds.has(item.recordingId) || (await memories.get(item.recordingId))) {
      items.push(item);
      continue;
    }
    const candidates = byPath.get(normalizedPath(item.filePath)) ?? [];
    if (!candidates.length) {
      items.push(item);
      continue;
    }
    const legacy =
      candidates.length === 1 ? await memories.get(candidates[0]!.recordingId) : undefined;
    if (
      !legacy ||
      !canRecoverLegacyRecording(legacy, item) ||
      legacy.phase === "transcribing" ||
      legacy.phase === "organizing" ||
      (legacy.phase === "idle" && legacy.taskStatus === "pending")
    ) {
      items.push({ ...item, voiceMemoryRecovery: "legacy_unverified" as const });
      continue;
    }
    try {
      await memories.reconcileRecordingIdentity(
        legacy.recordingId,
        item.recordingId,
        item.filePath,
        item.markers,
      );
    } catch (error) {
      if (!(
        error instanceof Error &&
        error.message === "voice_memory_record_exists" &&
        (await memories.get(item.recordingId))
      ))
        throw error;
    }
    items.push(item);
  }
  return { ...snapshot, items };
}
