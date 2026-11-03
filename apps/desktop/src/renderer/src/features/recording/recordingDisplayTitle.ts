import type { RecordingLibraryItem } from "@private-voice/shared";
import { automaticRecordingTitle } from "./recordingTimePeriod";
import { isAutomaticRecordingName } from "./recordingAutomaticName";

export const recordingDisplayTitle = (item: RecordingLibraryItem, sequence: number): string => {
  const stem = item.fileName.replace(/\.m4a$/i, "");
  if (
    item.title &&
    (item.isCustomTitle || item.title !== stem || !isAutomaticRecordingName(stem))
  ) {
    return item.title;
  }
  return automaticRecordingTitle(item.createdAt || item.modifiedAt, sequence);
};
