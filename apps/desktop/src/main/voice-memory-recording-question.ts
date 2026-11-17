import type {
  VoiceMemoryQuestionRequest,
  VoiceMemoryRecord,
  VoiceMemoryAnswer,
} from "@private-voice/shared";
import type { AiTextGateway } from "./ai-text-gateway";
import { ASSISTANT_ANSWER_STYLE, assistantAnswerText } from "./voice-memory-question-prompt";

export async function answerRecordingVoiceQuestion(
  request: VoiceMemoryQuestionRequest,
  record: VoiceMemoryRecord,
  gateway: Pick<AiTextGateway, "generateJson">,
  signal: AbortSignal,
): Promise<VoiceMemoryAnswer> {
  const terms = request.question
    .normalize("NFKC")
    .split(/\s+/)
    .filter((term) => term.length > 1);
  const candidates = record.transcript
    .map((segment) => ({
      segment,
      score: terms.reduce((score, term) => score + (segment.text.includes(term) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map(({ segment }) => segment);
  const answer = await gateway.generateJson<VoiceMemoryAnswer>({
    roomId: record.roomId,
    purpose: "question",
    manual: true,
    maxNewTokens: 700,
    signal,
    prompt: [
      "你是上号的本地语音记忆助手。只根据给出的录音片段回答朋友间的日常问题。",
      ...ASSISTANT_ANSWER_STYLE,
      '返回 JSON：{"text":"回答","sources":[{"startMs":数字,"segmentId":"id","quote":"简短原话"}]}。没有依据就明确说没找到。',
      `问题：${request.question.slice(0, 500)}`,
      "片段：",
      ...candidates.map(
        (segment) =>
          `${segment.id}\t${segment.startMs}\t${segment.nickname ?? segment.speakerId}\t${segment.text}`,
      ),
    ].join("\n"),
  });
  return {
    text: assistantAnswerText(answer.text),
    sources: (Array.isArray(answer.sources) ? answer.sources : [])
      .map((source) => {
        const segment = candidates.find((candidate) => candidate.id === source.segmentId);
        return segment
          ? {
              startMs: segment.startMs,
              segmentId: segment.id,
              quote: String(source.quote || segment.text).slice(0, 240),
              recordingId: record.recordingId,
              filePath: record.filePath,
              roomName: record.roomName,
              createdAt: record.createdAt,
            }
          : undefined;
      })
      .filter((source): source is NonNullable<typeof source> => Boolean(source))
      .slice(0, 8),
  };
}
