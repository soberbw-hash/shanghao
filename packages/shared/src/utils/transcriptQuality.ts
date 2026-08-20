import type { VoiceMemoryTranscriptSegment } from "../types/ai.types";
import type { VoiceMemoryRecord } from "../types/ai.types";

const SILENCE_LABEL = /^(?:non[\s-]?speech|no[\s-]?speech|silence|silent|music|noise)$/iu;
const WORD = /[\p{L}\p{N}']+/gu;
const transcriptReliabilityCache = new WeakMap<object, boolean>();

export const CURRENT_TRANSCRIPTION_PIPELINE_VERSION = 6;

const normalizedWords = (text: string): string[] =>
  text.normalize("NFKC").toLocaleLowerCase().match(WORD) ?? [];

const containsLongRepeatedRun = (text: string): boolean => {
  const compact = text.replace(/[^\p{L}\p{N}]+/gu, "");
  if (compact.length < 24) return false;
  for (let width = 1; width <= Math.min(8, Math.floor(compact.length / 8)); width += 1) {
    for (let index = 0; index + width * 8 <= compact.length; index += 1) {
      const unit = compact.slice(index, index + width);
      let repeats = 1;
      while (
        index + (repeats + 1) * width <= compact.length &&
        compact.slice(index + repeats * width, index + (repeats + 1) * width) === unit
      ) {
        repeats += 1;
      }
      const repeatedCharacters = repeats * width;
      if (repeats >= 8 && repeatedCharacters >= Math.max(24, compact.length * 0.55)) return true;
      index += Math.max(0, repeatedCharacters - width);
    }
  }
  return false;
};

/** Rejects model status labels, broken encoding and strongly repetitive hallucinations. */
export const isReliableTranscriptText = (text: string, durationMs = 30_000): boolean => {
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ").trim();
  const statusLabelCandidate = normalized
    .replaceAll("[", "")
    .replaceAll("]", "")
    .replace(/[().。！!？?]/g, "")
    .trim();
  if (!normalized || SILENCE_LABEL.test(statusLabelCandidate)) {
    return false;
  }
  const containsControlCharacter = [...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
  });
  if (normalized.includes("\uFFFD") || containsControlCharacter) {
    return false;
  }

  // A 30-second conversational chunk cannot plausibly contain thousands of characters.
  const maximumCharacters = Math.max(240, Math.ceil((durationMs / 1_000) * 45));
  if (normalized.length > maximumCharacters) return false;
  // Chinese does not contain spaces, so word-only checks see a long "对对对……" run as one
  // word. Catch repeated characters and short phrases before the word-count fast path.
  if (containsLongRepeatedRun(normalized)) return false;

  const words = normalizedWords(normalized);
  if (words.length < 12) return true;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const mostFrequent = Math.max(...counts.values());
  if (counts.size / words.length < 0.35 && mostFrequent / words.length > 0.35) return false;

  for (let width = 2; width <= Math.min(6, Math.floor(words.length / 3)); width += 1) {
    const phrases = new Map<string, number>();
    for (let index = 0; index <= words.length - width; index += 1) {
      const phrase = words.slice(index, index + width).join(" ");
      phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
    }
    if (Math.max(...phrases.values()) >= 3 && counts.size / words.length < 0.55) return false;
  }
  return true;
};

export const hasUnreliableTranscript = (
  transcript: readonly Pick<VoiceMemoryTranscriptSegment, "text" | "startMs" | "endMs">[],
): boolean => {
  const cached = transcriptReliabilityCache.get(transcript);
  if (cached !== undefined) return cached;
  const unreliable = transcript.some(
    (segment) =>
      !isReliableTranscriptText(segment.text, Math.max(100, segment.endMs - segment.startMs)),
  );
  transcriptReliabilityCache.set(transcript, unreliable);
  return unreliable;
};

export const hasInvalidVoiceMemoryResult = (
  record: Pick<
    VoiceMemoryRecord,
    "errorMessage" | "phase" | "transcript" | "transcriptionPipelineVersion"
  >,
): boolean =>
  record.errorMessage === "no_reliable_speech" ||
  (record.phase === "ready" && record.transcript.length === 0) ||
  (record.transcript.length > 0 &&
    (record.transcriptionPipelineVersion !== CURRENT_TRANSCRIPTION_PIPELINE_VERSION ||
      hasUnreliableTranscript(record.transcript)));
