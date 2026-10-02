import type { RecordingMarker } from "@private-voice/shared";

/** Read both legacy offset-only files and annotated game events without confusing wall time with offsets. */
export const parseRecordingMarkers = (source: string, recordingId: string): RecordingMarker[] => {
  const result: RecordingMarker[] = [];
  for (const line of source.split(/\r?\n/)) {
    const row = line.trim().replace(/^\d+\.\s*/, "");
    const match = row.match(/^(\d{2}):(\d{2}):(\d{2})/);
    if (!match) continue;
    const suffix = row.slice(match[0].length);
    result.push({
      id: `${recordingId}-${result.length}`,
      offsetMs: (Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000,
      createdAt: new Date(0).toISOString(),
      label: suffix.startsWith(" · ") ? suffix.slice(3, 99) : undefined,
    });
  }
  if (source.trim() && !result.length) throw new Error("recording_marker_unreadable");
  return result;
};
