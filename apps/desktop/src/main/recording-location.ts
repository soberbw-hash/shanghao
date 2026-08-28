import { stat } from "node:fs/promises";
import path from "node:path";

import { isAllowedRecordingPathInDirectory } from "./recording-library-core";

/**
 * Resolve a recording path for shell.showItemInFolder without relying on a
 * second library snapshot. The renderer already received this path from the
 * library; the main process only needs to verify that it is still a local M4A
 * inside the active recording directory and that it still exists.
 */
export const resolveRecordingPathForLocation = async (
  directory: string,
  requestedPath: string,
): Promise<string> => {
  const recordingPath = path.normalize(requestedPath);
  if (
    !path.isAbsolute(recordingPath) ||
    !isAllowedRecordingPathInDirectory(directory, recordingPath)
  ) {
    throw new Error("invalid_recording_path");
  }

  const fileStat = await stat(recordingPath).catch(() => undefined);
  if (!fileStat?.isFile()) throw new Error("recording_not_found");
  return recordingPath;
};
