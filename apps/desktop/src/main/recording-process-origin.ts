import path from "node:path";
import type { VoiceMemoryProcessRequest } from "@private-voice/shared";
import { readRecordingLibrary } from "./recording-library";
import { requireRecordingFileInDirectory } from "./recording-ipc-validation";

/** Renderer labels cannot retarget another recording or change its room/date. */
export const bindRecordingProcessOrigin = async (
  request: VoiceMemoryProcessRequest,
  directory: string,
  quotaGb: number,
): Promise<VoiceMemoryProcessRequest> => {
  const filePath = await requireRecordingFileInDirectory(directory, request.filePath);
  const library = await readRecordingLibrary(directory, quotaGb);
  const item = library.items.find(
    (entry) =>
      entry.recordingId === request.recordingId &&
      path.resolve(entry.filePath) === path.resolve(filePath),
  );
  if (!item) throw new Error("recording_file_unavailable");
  return {
    ...request,
    filePath,
    roomId: item.roomId,
    roomName: item.roomName,
    recordedAt: item.createdAt,
  };
};
