import type {
  AiAsrModelId,
  VoiceMemoryTranscriptSegment,
  VoiceMemoryTranscriptWord,
} from "../types/ai.types";

export const TRANSCRIPT_SENTENCE_PAUSE_MS = 850;
export const TRANSCRIPT_SENTENCE_MAX_CHARACTERS = 48;
const CLAUSE_BREAK_MIN_CHARACTERS = 28;

const TERMINAL_PUNCTUATION = /[。！？!?；;]\s*$/u;
const CLAUSE_PUNCTUATION = /[，,：:]\s*$/u;
const LEADING_PUNCTUATION = /^[，。！？!?；;：:、）)】\]”’]/u;
const TRAILING_OPEN_PUNCTUATION = /[（(【[“‘]$/u;
const LATIN_OR_NUMBER_END = /[\p{Script=Latin}\p{N}]$/u;
const LATIN_OR_NUMBER_START = /^[\p{Script=Latin}\p{N}]/u;

export const isQwenForcedAlignerModel = (modelId: AiAsrModelId): boolean =>
  modelId === "qwen3-asr-0.6b-force" || modelId === "qwen3-asr-1.7b-force";

const characterCount = (text: string): number => [...text].length;

const joinAlignedText = (left: string, right: string): string => {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/u.test(left) || /^\s/u.test(right)) return left + right;
  if (LEADING_PUNCTUATION.test(right) || TRAILING_OPEN_PUNCTUATION.test(left)) {
    return left + right;
  }
  if (LATIN_OR_NUMBER_END.test(left) && LATIN_OR_NUMBER_START.test(right)) {
    return `${left} ${right}`;
  }
  return left + right;
};

const segmentWords = (segment: VoiceMemoryTranscriptSegment): VoiceMemoryTranscriptWord[] =>
  segment.words?.length
    ? segment.words.map((word) => ({ ...word }))
    : [
        {
          id: segment.id,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
        },
      ];

const sameSpeaker = (
  left: VoiceMemoryTranscriptSegment,
  right: VoiceMemoryTranscriptSegment,
): boolean => left.speakerId === right.speakerId;

const shouldFinishSentence = (segment: VoiceMemoryTranscriptSegment): boolean =>
  TERMINAL_PUNCTUATION.test(segment.text) ||
  (CLAUSE_PUNCTUATION.test(segment.text) &&
    characterCount(segment.text) >= CLAUSE_BREAK_MIN_CHARACTERS);

/**
 * Turns word-level ASR output into readable seekable sentences without discarding alignment.
 * Calling this repeatedly is safe: already merged segments retain and reuse their word arrays.
 */
export const mergeTranscriptIntoSentences = (
  transcript: readonly VoiceMemoryTranscriptSegment[],
  options: { pauseMs?: number; maxCharacters?: number } = {},
): VoiceMemoryTranscriptSegment[] => {
  const pauseMs = options.pauseMs ?? TRANSCRIPT_SENTENCE_PAUSE_MS;
  const maxCharacters = options.maxCharacters ?? TRANSCRIPT_SENTENCE_MAX_CHARACTERS;
  const ordered = [...transcript]
    .filter((segment) => segment.text.trim())
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const sentences: VoiceMemoryTranscriptSegment[] = [];
  let current: VoiceMemoryTranscriptSegment | undefined;

  const finishCurrent = () => {
    if (!current) return;
    sentences.push(current);
    current = undefined;
  };

  for (const source of ordered) {
    const next: VoiceMemoryTranscriptSegment = {
      ...source,
      text: source.text.trim(),
      words: segmentWords(source),
    };
    if (!current) {
      current = next;
      continue;
    }

    const gapMs = Math.max(0, next.startMs - current.endMs);
    const joinedText = joinAlignedText(current.text, next.text);
    if (
      !sameSpeaker(current, next) ||
      gapMs > pauseMs ||
      shouldFinishSentence(current) ||
      (characterCount(joinedText) > maxCharacters && !LEADING_PUNCTUATION.test(next.text))
    ) {
      finishCurrent();
      current = next;
      continue;
    }

    current = {
      ...current,
      endMs: Math.max(current.endMs, next.endMs),
      text: joinedText,
      words: [...(current.words ?? []), ...(next.words ?? [])],
    };
  }

  finishCurrent();
  return sentences;
};
