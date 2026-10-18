/** Prefix legacy clock labels without confusing them with an offset inside the recording. */
export const formatRecordingMarkerLabel = (label: string) =>
  label.replace(/^(\d{1,2}):(\d{2})\s+/, "时钟 $1点$2分 · ");
