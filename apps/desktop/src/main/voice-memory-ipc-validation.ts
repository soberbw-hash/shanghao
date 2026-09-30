import type { VoiceMemoryProcessRequest } from "@private-voice/shared";

const validText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

const validOptionalText = (value: unknown, maximum: number): boolean =>
  value === undefined || (typeof value === "string" && value.length <= maximum);

const validOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === "boolean";

const validOffset = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 604_800_000;

export const requireVoiceMemoryProcessRequest = (value: unknown): VoiceMemoryProcessRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_voice_memory_process_request");
  }
  const request = value as Partial<VoiceMemoryProcessRequest>;
  if (
    !validText(request.recordingId, 2_048) ||
    !validText(request.filePath, 2_048) ||
    !validOptionalText(request.roomId, 128) ||
    !validOptionalText(request.roomName, 160) ||
    !validOptionalText(request.taskId, 256) ||
    !validOptionalBoolean(request.manual) ||
    !validOptionalBoolean(request.organize) ||
    !validOptionalBoolean(request.transcribe) ||
    !validOptionalBoolean(request.restartTranscription) ||
    (request.markers !== undefined &&
      (!Array.isArray(request.markers) ||
        request.markers.length > 2_000 ||
        request.markers.some(
          (marker) => !marker || !validText(marker.id, 128) || !validOffset(marker.offsetMs),
        ))) ||
    (request.speakingTimeline !== undefined &&
      (!Array.isArray(request.speakingTimeline) ||
        request.speakingTimeline.length > 40_000 ||
        request.speakingTimeline.some(
          (observation) =>
            !observation ||
            !validOffset(observation.offsetMs) ||
            !validText(observation.memberId, 180) ||
            typeof observation.nickname !== "string" ||
            observation.nickname.length > 80 ||
            !validOptionalText(observation.userId, 180) ||
            !validOptionalText(observation.usernameSnapshot, 180) ||
            !validOptionalText(observation.displayNameSnapshot, 180),
        ))) ||
    (request.benchmark !== undefined &&
      (!request.benchmark ||
        typeof request.benchmark !== "object" ||
        Array.isArray(request.benchmark) ||
        (request.benchmark.clips !== undefined &&
          (!Array.isArray(request.benchmark.clips) || request.benchmark.clips.length > 64))))
  ) {
    throw new Error("invalid_voice_memory_process_request");
  }
  try {
    if (Buffer.byteLength(JSON.stringify(request), "utf8") > 8 * 1024 * 1024) {
      throw new Error("invalid_voice_memory_process_request");
    }
  } catch {
    throw new Error("invalid_voice_memory_process_request");
  }
  return request as VoiceMemoryProcessRequest;
};
