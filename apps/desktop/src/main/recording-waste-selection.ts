import type {
  RecordingBatchDeleteResult,
  RecordingCleanupCandidate,
  RecordingCleanupScan,
} from "@private-voice/shared";

/** Only native scan results authorize waste cleanup; UI-provided reasons are never trusted. */
export const createRecordingWasteSelection = (
  recycle: (candidate: RecordingCleanupCandidate) => Promise<void>,
) => {
  const approved = new Map<string, RecordingCleanupCandidate>();
  let busy = false;
  return {
    async scan(read: () => Promise<RecordingCleanupScan>): Promise<RecordingCleanupScan> {
      if (busy) throw new Error("recording_cleanup_busy");
      busy = true;
      approved.clear();
      try {
        const scan = await read();
        const candidates = scan.candidates.filter((candidate) => {
          if (candidate.reason === "unreadable") return true;
          if (approved.size >= 500) return false;
          if (candidate.reason !== "too_short" && candidate.reason !== "silent") return false;
          approved.set(candidate.filePath, candidate);
          return true;
        });
        return { ...scan, candidates };
      } finally {
        busy = false;
      }
    },
    async clean(value: unknown): Promise<RecordingBatchDeleteResult> {
      if (busy) throw new Error("recording_cleanup_busy");
      if (
        !Array.isArray(value) ||
        value.length > 500 ||
        value.some((file) => typeof file !== "string" || !file.trim() || file.length > 2048)
      ) {
        throw new Error("invalid_recording_cleanup_batch");
      }
      busy = true;
      const result: RecordingBatchDeleteResult = { deletedFilePaths: [], failed: [] };
      try {
        for (const filePath of new Set<string>(value)) {
          try {
            const candidate = approved.get(filePath);
            if (!candidate) throw new Error("recording_cleanup_rescan_required");
            await recycle(candidate);
            approved.delete(filePath);
            result.deletedFilePaths.push(filePath);
          } catch (failure) {
            result.failed.push({
              filePath,
              message: failure instanceof Error ? failure.message : String(failure),
            });
          }
        }
        return result;
      } finally {
        busy = false;
      }
    },
  };
};
