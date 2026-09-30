import { lstat, realpath } from "node:fs/promises";

import { isAllowedRecordingPathInDirectory } from "./recording-library-core";

/** Renderer-supplied paths must resolve to an actual recording inside the selected library. */
export const requireRecordingFileInDirectory = async (
  directory: string,
  filePath: unknown,
): Promise<string> => {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 2_048) {
    throw new Error("invalid_recording_file_path");
  }
  if (!isAllowedRecordingPathInDirectory(directory, filePath)) {
    throw new Error("invalid_recording_file_path");
  }
  const [realDirectory, realFilePath, file] = await Promise.all([
    realpath(directory),
    realpath(filePath),
    lstat(filePath),
  ]).catch(() => {
    throw new Error("invalid_recording_file_path");
  });
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    !isAllowedRecordingPathInDirectory(realDirectory, realFilePath)
  ) {
    throw new Error("invalid_recording_file_path");
  }
  return filePath;
};

export const requireRecordingMarkerOffsets = (markers: unknown): number[] => {
  if (!Array.isArray(markers) || markers.length > 2_000) {
    throw new Error("invalid_recording_markers");
  }
  return markers.map((marker: unknown) => {
    const offset =
      marker && typeof marker === "object" ? (marker as { offsetMs?: unknown }).offsetMs : null;
    if (
      !Number.isSafeInteger(offset) ||
      (offset as number) < 0 ||
      (offset as number) > 604_800_000
    ) {
      throw new Error("invalid_recording_markers");
    }
    return offset as number;
  });
};
