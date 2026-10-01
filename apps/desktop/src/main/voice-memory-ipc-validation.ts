import { AI_ASR_MODEL_NAMES, type VoiceMemoryProcessRequest } from "@private-voice/shared";

const validText = (value: unknown, maximum: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;

const validOptionalText = (value: unknown, maximum: number): boolean =>
  value === undefined || (typeof value === "string" && value.length <= maximum);

const validOptionalBoolean = (value: unknown): boolean =>
  value === undefined || typeof value === "boolean";

const validOffset = (value: unknown): boolean =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 604_800_000;

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const validRange = (value: Record<string, unknown>, start: string, end: string): boolean =>
  (value[start] === undefined || validOffset(value[start])) &&
  (value[end] === undefined || validOffset(value[end])) &&
  (value[start] === undefined ||
    value[end] === undefined ||
    (value[end] as number) >= (value[start] as number));

const validBenchmark = (value: unknown): boolean => {
  if (value === undefined) return true;
  if (
    !object(value) ||
    (value.mode !== undefined && !["smoke", "standard", "long"].includes(value.mode as string))
  ) {
    return false;
  }
  if (
    value.clips !== undefined &&
    (!Array.isArray(value.clips) ||
      value.clips.length > 64 ||
      value.clips.some(
        (clip) =>
          !object(clip) ||
          !validOffset(clip.startMs) ||
          !validOffset(clip.endMs) ||
          !validRange(clip, "startMs", "endMs") ||
          !validRange(clip, "sourceStartMs", "sourceEndMs") ||
          !validRange(clip, "clipLocalStartMs", "clipLocalEndMs") ||
          !validOptionalText(clip.groundTruthText, 200_000) ||
          (clip.importantKeywords !== undefined &&
            (!Array.isArray(clip.importantKeywords) ||
              clip.importantKeywords.length > 200 ||
              clip.importantKeywords.some((keyword) => !validText(keyword, 256)))),
      ))
  )
    return false;
  if (value.environment !== undefined) {
    if (!object(value.environment)) return false;
    const environment = value.environment;
    if (
      [
        "gpu",
        "cpu",
        "os",
        "cudaVersion",
        "pytorchVersion",
        "appVersion",
        "gitCommit",
        "adapterVersion",
      ].some((key) => !validOptionalText(environment[key], 256))
    )
      return false;
    if (
      ["gpuTotalVramMb", "ramMb", "pipelineVersion"].some(
        (key) =>
          environment[key] !== undefined &&
          (typeof environment[key] !== "number" ||
            !Number.isFinite(environment[key]) ||
            environment[key] < 0 ||
            environment[key] > 1_048_576),
      )
    )
      return false;
    if (
      environment.pipelineVersion !== undefined &&
      !Number.isSafeInteger(environment.pipelineVersion)
    )
      return false;
  }
  return true;
};

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
    (request.asrModelId !== undefined &&
      (typeof request.asrModelId !== "string" ||
        !Object.hasOwn(AI_ASR_MODEL_NAMES, request.asrModelId))) ||
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
    !validBenchmark(request.benchmark)
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
