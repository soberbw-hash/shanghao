import type {
  AiAsrModelId,
  VoiceMemoryTranscriptSegment,
  VoiceMemoryTranscriptWord,
} from "../types/ai.types";

export const TRANSCRIPT_SENTENCE_PAUSE_MS = 850;
export const TRANSCRIPT_SENTENCE_MAX_CHARACTERS = 48;
const CLAUSE_BREAK_MIN_CHARACTERS = 28;

export const READABLE_PARAGRAPH_DEFAULTS = {
  preferredMergeGapMs: 2_000,
  conditionalMergeGapMs: 4_000,
  softDurationMs: 22_000,
  hardDurationMs: 30_000,
  softCharacters: 96,
  hardCharacters: 150,
  clauseJoinGapMs: 500,
} as const;

export interface ReadableParagraphOptions {
  preferredMergeGapMs?: number;
  conditionalMergeGapMs?: number;
  softDurationMs?: number;
  hardDurationMs?: number;
  softCharacters?: number;
  hardCharacters?: number;
  clauseJoinGapMs?: number;
}

export interface ReadableTranscriptParagraph extends VoiceMemoryTranscriptSegment {
  /** Original sentence/segment ids covered by this display-only paragraph. */
  sourceSegmentIds: string[];
  /** Keeps every source timestamp and nested word timestamp available to the UI. */
  sourceSegments: VoiceMemoryTranscriptSegment[];
}

const TERMINAL_PUNCTUATION = /[。！？!?；;]\s*$/u;
const CLAUSE_PUNCTUATION = /[，,：:]\s*$/u;
const LEADING_PUNCTUATION = /^[，。！？!?；;：:、）)】\]”’]/u;
const TRAILING_OPEN_PUNCTUATION = /[（(【[“‘]$/u;
const LATIN_OR_NUMBER_END = /[\p{Script=Latin}\p{N}]$/u;
const LATIN_OR_NUMBER_START = /^[\p{Script=Latin}\p{N}]/u;
const LATIN_END = /\p{Script=Latin}$/u;
const LATIN_START = /^\p{Script=Latin}/u;
const CJK_END = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u;
const CJK_START = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const ANY_PUNCTUATION_END = /[，,。.!！?？；;：:、]$/u;
const LEADING_SENTENCE_PUNCTUATION = /^[，,。.!！?？；;：:、]+\s*/u;
const REPEATED_PUNCTUATION = /([，。！？；：、,.!?;:])\1+/gu;
const CONTINUATION_START =
  /^(?:但|但是|不过|然后|所以|而且|还有|因为|如果|那|就|再|接着|同时|其实|反正|结果|于是|或者|以及|也|还)/u;

export const isQwenForcedAlignerModel = (modelId: AiAsrModelId): boolean =>
  modelId === "qwen3-asr-0.6b-force" || modelId === "qwen3-asr-1.7b-force";

const characterCount = (text: string): number => [...text].length;

const normalizeReadableText = (text: string): string =>
  text.trim().replace(/\s+/gu, " ").replace(REPEATED_PUNCTUATION, "$1");

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
      rawSegments: [...(current.rawSegments ?? []), ...(next.rawSegments ?? [])],
    };
  }

  finishCurrent();
  return sentences;
};

const joinParagraphText = (
  leftText: string,
  rightText: string,
  gapMs: number,
  clauseJoinGapMs: number,
): string => {
  const left = normalizeReadableText(leftText);
  let right = normalizeReadableText(rightText);
  if (!left) return right;
  if (!right) return left;

  if (ANY_PUNCTUATION_END.test(left)) {
    right = right.replace(LEADING_SENTENCE_PUNCTUATION, "");
    if (!right) return left;
    const needsEnglishSentenceSpace =
      /[\p{Script=Latin}\p{N}][.!?;:,]$/u.test(left) && LATIN_OR_NUMBER_START.test(right);
    return normalizeReadableText(`${left}${needsEnglishSentenceSpace ? " " : ""}${right}`);
  }
  if (LEADING_PUNCTUATION.test(right) || TRAILING_OPEN_PUNCTUATION.test(left)) {
    return normalizeReadableText(left + right);
  }
  if (
    (LATIN_END.test(left) && (LATIN_START.test(right) || CJK_START.test(right))) ||
    (CJK_END.test(left) && LATIN_START.test(right))
  ) {
    return normalizeReadableText(`${left} ${right}`);
  }
  if (gapMs >= clauseJoinGapMs && (CJK_END.test(left) || CJK_START.test(right))) {
    return normalizeReadableText(`${left}，${right}`);
  }
  return normalizeReadableText(joinAlignedText(left, right));
};

const paragraphShouldBreak = (
  current: ReadableTranscriptParagraph,
  next: ReadableTranscriptParagraph,
  options: Required<ReadableParagraphOptions>,
): boolean => {
  if (!sameSpeaker(current, next)) return true;
  const gapMs = Math.max(0, next.startMs - current.endMs);
  if (gapMs > options.conditionalMergeGapMs) return true;

  const nextText = joinParagraphText(current.text, next.text, gapMs, options.clauseJoinGapMs);
  const nextDurationMs = Math.max(current.endMs, next.endMs) - current.startMs;
  const nextCharacters = characterCount(nextText);
  if (nextDurationMs > options.hardDurationMs || nextCharacters > options.hardCharacters) {
    return true;
  }

  const currentDurationMs = current.endMs - current.startMs;
  const currentCharacters = characterCount(current.text);
  const reachedSoftLimit =
    currentDurationMs >= options.softDurationMs || currentCharacters >= options.softCharacters;
  if (gapMs <= options.preferredMergeGapMs) {
    return reachedSoftLimit && shouldFinishSentence(current);
  }

  if (reachedSoftLimit) return true;
  const shortSide = Math.min(currentCharacters, characterCount(next.text)) <= 32;
  return shouldFinishSentence(current) && !CONTINUATION_START.test(next.text) && !shortSide;
};

/**
 * Builds display-only natural paragraphs while retaining every sentence and word timestamp.
 * Model output, benchmark counts, persistence, search and exports must continue using the input.
 */
export const buildReadableTranscriptParagraphs = (
  transcript: readonly VoiceMemoryTranscriptSegment[],
  requestedOptions: ReadableParagraphOptions = {},
): ReadableTranscriptParagraph[] => {
  const options: Required<ReadableParagraphOptions> = {
    ...READABLE_PARAGRAPH_DEFAULTS,
    ...requestedOptions,
  };
  const orderedSources = [...transcript]
    .filter((segment) => segment.text.trim())
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const sentences = mergeTranscriptIntoSentences(transcript);
  const paragraphs: ReadableTranscriptParagraph[] = [];
  let current: ReadableTranscriptParagraph | undefined;
  let sourceCursor = 0;

  const finishCurrent = () => {
    if (!current) return;
    paragraphs.push(current);
    current = undefined;
  };

  for (const sentence of sentences) {
    const source = {
      ...sentence,
      words: sentence.words?.map((word) => ({ ...word })),
      rawSegments: sentence.rawSegments ? [...sentence.rawSegments] : undefined,
    };
    const directSources: VoiceMemoryTranscriptSegment[] = [];
    while (sourceCursor < orderedSources.length) {
      const segment = orderedSources[sourceCursor]!;
      if (segment.endMs < sentence.startMs) {
        sourceCursor += 1;
        continue;
      }
      if (segment.startMs > sentence.endMs) break;
      if (
        !sameSpeaker(segment, sentence) ||
        segment.startMs < sentence.startMs ||
        segment.endMs > sentence.endMs
      )
        break;
      directSources.push({
        ...segment,
        words: segment.words?.map((word) => ({ ...word })),
        rawSegments: segment.rawSegments ? [...segment.rawSegments] : undefined,
      });
      sourceCursor += 1;
    }
    const sourceSegments = directSources.length ? directSources : [source];
    const next: ReadableTranscriptParagraph = {
      ...source,
      text: normalizeReadableText(source.text),
      sourceSegmentIds: sourceSegments.map((segment) => segment.id),
      sourceSegments,
    };
    if (!current) {
      current = next;
      continue;
    }
    if (paragraphShouldBreak(current, next, options)) {
      finishCurrent();
      current = next;
      continue;
    }

    const gapMs = Math.max(0, next.startMs - current.endMs);
    current = {
      ...current,
      endMs: Math.max(current.endMs, next.endMs),
      text: joinParagraphText(current.text, next.text, gapMs, options.clauseJoinGapMs),
      words: [...(current.words ?? []), ...(next.words ?? [])],
      rawSegments: [...(current.rawSegments ?? []), ...(next.rawSegments ?? [])],
      sourceSegmentIds: [...current.sourceSegmentIds, ...next.sourceSegmentIds],
      sourceSegments: [...current.sourceSegments, ...next.sourceSegments],
    };
  }

  finishCurrent();
  return paragraphs;
};
