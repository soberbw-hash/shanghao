import type {
  RecordingCleanupCandidate,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@private-voice/shared";
import { isAutomaticWasteCandidate } from "./recording-cleanup";

export interface AutomaticRecordingCleanupResult {
  deletedItems: RecordingLibraryItem[];
  wasteDeletedCount: number;
  quotaDeletedCount: number;
}

/** Capacity is a trigger to inspect silence, never permission to discard audible files. */
export const cleanSilentRecordings = async (options: {
  enabled: boolean;
  newestFilePath?: string;
  read: () => Promise<RecordingLibrarySnapshot>;
  inspect: (item: RecordingLibraryItem) => Promise<RecordingCleanupCandidate | undefined>;
  recycle: (item: RecordingLibraryItem) => Promise<void>;
}): Promise<AutomaticRecordingCleanupResult> => {
  const result: AutomaticRecordingCleanupResult = {
    deletedItems: [],
    wasteDeletedCount: 0,
    quotaDeletedCount: 0,
  };
  if (!options.enabled) return result;
  const snapshot = await options.read();
  const inspected = new Set<string>();
  let bytes = snapshot.totalBytes;
  const eligible = snapshot.items.filter((item) => !item.isFavorite && item.markers.length === 0);
  const inspect = async (item: RecordingLibraryItem, quota: boolean) => {
    inspected.add(item.filePath);
    const candidate = await options.inspect(item).catch(() => undefined);
    if (!isAutomaticWasteCandidate(candidate) || candidate.filePath !== item.filePath) return;
    const recycled = await options.recycle(item).then(
      () => true,
      () => false,
    );
    if (!recycled) return;
    result.deletedItems.push(item);
    result.wasteDeletedCount++;
    if (quota) result.quotaDeletedCount++;
    bytes -= item.fileSize;
  };
  const newest = eligible.find((item) => item.filePath === options.newestFilePath);
  if (newest) await inspect(newest, false);
  // A growing catalog must not cause an unbounded series of audio decodes.
  for (const item of [...eligible].reverse()) {
    if (bytes <= snapshot.quotaBytes || inspected.size >= 9) break;
    if (!inspected.has(item.filePath)) await inspect(item, true);
  }
  return result;
};
