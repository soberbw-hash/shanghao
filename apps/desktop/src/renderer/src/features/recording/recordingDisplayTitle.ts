import type { RecordingLibraryItem } from "@private-voice/shared";

const isAutomaticName = (name: string): boolean => {
  const stem = name.replace(/ \(\d+\)$/, "");
  return (
    (stem.startsWith("上号-") || stem.startsWith("ShangHao-")) &&
    /\d{4}-\d{2}-\d{2}/.test(stem) &&
    /(?:\d{2}时\d{2}分|\d{2}-\d{2}-\d{2}|\d{2}-\d{2}-\d{2}\.\d{3}Z)$/.test(stem)
  );
};

export const recordingDisplayTitle = (item: RecordingLibraryItem, sequence: number): string => {
  const stem = item.fileName.replace(/\.m4a$/i, "");
  if (item.title && (item.isCustomTitle || item.title !== stem || !isAutomaticName(stem))) {
    return item.title;
  }
  return `语音 ${String(sequence).padStart(2, "0")}`;
};
