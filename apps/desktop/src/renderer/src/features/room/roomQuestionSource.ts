import type { VoiceMemoryAnswer } from "@private-voice/shared";

type Source = VoiceMemoryAnswer["sources"][number];
const sourceDate = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A source's wall-clock time is recording start plus its audio offset, not send time. */
export const formatRoomSourceTime = (source: Source): string => {
  const offset = Number.isFinite(source.startMs) ? Math.max(0, source.startMs) : 0;
  const recordingStart = source.createdAt ? Date.parse(source.createdAt) : NaN;
  const timestamp = recordingStart + offset;
  if (!Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15) {
    const seconds = Math.floor(offset / 1_000);
    return `日期未知 · 录音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const parts = Object.fromEntries(
    sourceDate.formatToParts(timestamp).map((p) => [p.type, p.value]),
  );
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`;
};

export const roomQuestionSources = (answer: VoiceMemoryAnswer, roomId: string): Source[] =>
  answer.sources.filter(
    (source) =>
      // Legacy answers came through the same scoped IPC and v2 per-room history.
      // Explicitly scoped answers must match; the backend stamps new sources.
      (source.roomId === undefined || source.roomId === roomId) &&
      Number.isFinite(source.startMs) &&
      source.startMs >= 0 &&
      typeof source.quote === "string",
  );
