import type { RecordingGameTimeline, VoiceMemoryLocalAsrContext } from "@private-voice/shared";
import { isLocalAsrContext } from "./local-asr-context";

export function isRecordingGameTimeline(value: unknown): value is RecordingGameTimeline {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const timeline = value as Record<string, unknown>;
  if (
    timeline.schemaVersion !== 1 ||
    typeof timeline.roomId !== "string" ||
    !timeline.roomId ||
    timeline.roomId.length > 128 ||
    typeof timeline.durationMs !== "number" ||
    !Number.isSafeInteger(timeline.durationMs) ||
    timeline.durationMs < 0 ||
    timeline.durationMs > 604_800_000 ||
    typeof timeline.complete !== "boolean" ||
    !Array.isArray(timeline.events) ||
    timeline.events.length > 2000
  )
    return false;
  let previous = -1;
  for (const value of timeline.events) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const event = value as Record<string, unknown>;
    if (
      typeof event.memberId !== "string" ||
      !event.memberId ||
      event.memberId.length > 180 ||
      typeof event.offsetMs !== "number" ||
      !Number.isSafeInteger(event.offsetMs) ||
      event.offsetMs < 0 ||
      event.offsetMs < previous ||
      event.offsetMs > timeline.durationMs ||
      typeof event.present !== "boolean" ||
      (event.gameName !== undefined &&
        (typeof event.gameName !== "string" ||
          !event.gameName ||
          event.gameName.length > 80 ||
          !event.present))
    )
      return false;
    previous = event.offsetMs;
  }
  return true;
}

/** Never project a current game onto old audio or across a member/transition boundary. */
export function recordingGameContextForRange(
  timeline: RecordingGameTimeline | undefined,
  roomId: string | undefined,
  memberId: string | undefined,
  startMs: number,
  endMs: number,
): VoiceMemoryLocalAsrContext | undefined {
  if (
    !timeline ||
    !isRecordingGameTimeline(timeline) ||
    !timeline.complete ||
    !roomId ||
    timeline.roomId !== roomId ||
    !memberId ||
    startMs < 0 ||
    endMs <= startMs ||
    endMs > timeline.durationMs
  )
    return undefined;
  const events = timeline.events.filter((event) => event.memberId === memberId);
  const previous = events.filter((event) => event.offsetMs <= startMs).at(-1);
  if (
    !previous?.present ||
    !previous.gameName ||
    events.some((event) => event.offsetMs > startMs && event.offsetMs < endMs)
  )
    return undefined;
  const context = { gameName: previous.gameName, terms: [] };
  return isLocalAsrContext(context) ? context : undefined;
}
