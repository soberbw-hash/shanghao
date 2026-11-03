import type { RecordingCleanupCandidate, RecordingLibraryItem } from "@private-voice/shared";

export const shouldRecycleRecording = (
  probe: RecordingCleanupCandidate | undefined,
  includeShort: boolean,
): boolean =>
  probe?.reason === "silent" ||
  (includeShort &&
    probe?.reason === "too_short" &&
    typeof probe.durationMs === "number" &&
    probe.durationMs > 0 &&
    probe.durationMs <= 300_000);

/** Rotate a bounded scan so long, protected or unreadable recordings cannot starve older files. */
export function selectRecordingMaintenanceBatch(
  items: RecordingLibraryItem[],
  cursor: number,
  newest?: string,
  now = Date.now(),
) {
  const eligible = items.filter(
    (item) =>
      !item.isFavorite &&
      !item.markers.length &&
      (item.filePath === newest || now - Date.parse(item.modifiedAt) > 120_000),
  );
  const first = eligible.find((item) => item.filePath === newest);
  const remaining = eligible.filter((item) => item !== first);
  const start = remaining.length ? cursor % remaining.length : 0;
  const count = Math.min(remaining.length, first ? 7 : 8);
  const batch = Array.from({ length: count }, (_, i) => remaining[(start + i) % remaining.length]!);
  return {
    items: first ? [first, ...batch] : batch,
    cursor: remaining.length ? (start + count) % remaining.length : 0,
  };
}
