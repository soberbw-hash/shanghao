import {
  recordingClipRange,
  recordingClipWindow,
  type RecordingClipRequest,
} from "@private-voice/shared";

export const requireRecordingClipRequest = (value: unknown): RecordingClipRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("clip_invalid_request");
  const request = value as RecordingClipRequest;
  if (typeof request.filePath !== "string" || !request.filePath || request.filePath.length > 2048)
    throw new Error("clip_invalid_request");
  if (request.startMs !== undefined || request.endMs !== undefined) {
    if (
      request.markerId !== undefined ||
      request.beforeMs !== undefined ||
      request.afterMs !== undefined ||
      !Number.isSafeInteger(request.startMs) ||
      !Number.isSafeInteger(request.endMs)
    )
      throw new Error("clip_invalid_request");
    recordingClipRange(request.startMs!, request.endMs!, Number.MAX_SAFE_INTEGER);
    return { filePath: request.filePath, startMs: request.startMs!, endMs: request.endMs! };
  }
  if (typeof request.markerId !== "string" || !request.markerId || request.markerId.length > 160)
    throw new Error("clip_invalid_request");
  recordingClipWindow(120000, 240000, request.beforeMs, request.afterMs);
  return {
    filePath: request.filePath,
    markerId: request.markerId,
    beforeMs: request.beforeMs,
    afterMs: request.afterMs,
  };
};
