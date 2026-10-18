import type { VoiceMemoryAnswer, VoiceMemoryGlobalQuestionRequest } from "@private-voice/shared";
import type { AiTextGateway } from "./ai-text-gateway";
import type { VoiceMemoryStore } from "./voice-memory-store";
import { assistantAnswerText, roomQuestionPrompt } from "./voice-memory-question-prompt";

const capabilityQuestions = new Set([
  "你能做什么",
  "你会做什么",
  "你可以做什么",
  "你能帮我做什么",
  "你有什么功能",
  "你有什么能力",
]);

/** The app's own help text describes implemented features, independent of a model's guesses. */
export const answerGlobalVoiceQuestion = async (
  request: VoiceMemoryGlobalQuestionRequest,
  gateway: Pick<AiTextGateway, "questionRoomId" | "generateJson">,
  store: Pick<VoiceMemoryStore, "related">,
  run: <T>(operation: (signal: AbortSignal) => Promise<T>) => Promise<T>,
): Promise<VoiceMemoryAnswer> => {
  const question = request.question.trim().slice(0, 500);
  if (!question) throw new Error("memory_question_required");
  return run(async (signal) => {
    const roomId = gateway.questionRoomId();
    if (request.roomId !== undefined && request.roomId !== roomId)
      throw new Error("ai_question_room_changed");
    if (capabilityQuestions.has(question.replace(/[?？。！!\s]/gu, ""))) {
      return {
        text: "可以帮你解答游戏问题，也能查找房间里的语音记录。直接输入想问的问题就好。",
        sources: [],
      };
    }
    const candidates = roomId ? store.related(question, 24, roomId) : [];
    const answer = await gateway.generateJson<VoiceMemoryAnswer>({
      roomId,
      purpose: "question",
      manual: true,
      maxNewTokens: 700,
      signal,
      prompt: roomQuestionPrompt(question, candidates),
    });
    signal.throwIfAborted();
    if (gateway.questionRoomId() !== roomId) throw new Error("ai_question_room_changed");
    return {
      text: assistantAnswerText(answer.text),
      sources: (Array.isArray(answer.sources) ? answer.sources : [])
        .flatMap((source) => {
          const match = /^memory-(\d+)$/.exec(source.segmentId);
          const candidate = match
            ? candidates[Number.parseInt(match[1] ?? "0", 10) - 1]
            : undefined;
          return candidate
            ? [
                {
                  startMs: candidate.startMs,
                  segmentId: source.segmentId,
                  quote: String(source.quote || candidate.excerpt).slice(0, 240),
                  recordingId: candidate.recordingId,
                  filePath: candidate.filePath,
                  roomName: candidate.roomName,
                  createdAt: candidate.createdAt,
                },
              ]
            : [];
        })
        .slice(0, 8),
    };
  });
};
