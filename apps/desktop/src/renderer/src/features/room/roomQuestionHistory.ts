import type { VoiceMemoryAnswer } from "@private-voice/shared";

export interface RoomQuestionHistoryEntry {
  id: string;
  question: string;
  answer: VoiceMemoryAnswer;
  createdAt: string;
}

export const roomQuestionHistoryKey = (roomId: string) =>
  `shanghao:room-question-history:v2:${encodeURIComponent(roomId)}`;
const ROOM_QUESTION_HISTORY_LIMIT = 10;
export const readQuestionHistory = (roomId: string): RoomQuestionHistoryEntry[] => {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(roomQuestionHistoryKey(roomId)) ?? "[]",
    ) as RoomQuestionHistoryEntry[] | undefined;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry) =>
          typeof entry?.id === "string" &&
          typeof entry.question === "string" &&
          typeof entry.createdAt === "string" &&
          typeof entry.answer?.text === "string" &&
          Array.isArray(entry.answer.sources) &&
          entry.answer.sources.every(
            (source) =>
              typeof source?.startMs === "number" &&
              Number.isFinite(source.startMs) &&
              typeof source.quote === "string",
          ),
      )
      .slice(0, ROOM_QUESTION_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

export const rememberQuestion = (
  roomId: string,
  history: RoomQuestionHistoryEntry[],
  question: string,
  answer: VoiceMemoryAnswer,
): RoomQuestionHistoryEntry[] => {
  const next = [
    {
      id: crypto.randomUUID(),
      question,
      answer,
      createdAt: new Date().toISOString(),
    },
    ...history,
  ].slice(0, ROOM_QUESTION_HISTORY_LIMIT);
  try {
    window.localStorage.setItem(roomQuestionHistoryKey(roomId), JSON.stringify(next));
  } catch {
    // A full or unavailable local store must not block the current answer.
  }
  return next;
};
