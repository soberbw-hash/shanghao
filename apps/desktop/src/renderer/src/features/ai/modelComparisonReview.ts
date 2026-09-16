import type {
  VoiceMemoryTranscriptionUnit,
  VoiceMemoryTranscriptionVariant,
} from "@private-voice/shared";

// Review candidates only; never rewrite ASR text or use peer output as ground truth.
export const BENCHMARK_REVIEW_CONFIG = {
  shortUnitMs: 1_200,
  carryoverSimilarity: 0.85,
  carryoverMinCharacters: 8,
  carryoverCharactersPerSecond: 10,
  previousUnitMaxGapMs: 4_000,
  peerMinimumCharacters: 12,
  peerLengthRatio: 0.25,
} as const;

export function comparisonTextForUnit(
  variant: VoiceMemoryTranscriptionVariant,
  unit: VoiceMemoryTranscriptionUnit,
): string {
  // The final transcript may merge several units into one sentence. Its entire text must
  // not be attributed to every overlapping unit. Durable per-unit output precedes merging.
  if (unit.rawRuntimeOutput) {
    try {
      const evidence: unknown = JSON.parse(unit.rawRuntimeOutput);
      if (
        evidence &&
        typeof evidence === "object" &&
        "segments" in evidence &&
        Array.isArray(evidence.segments)
      ) {
        return evidence.segments
          .map((segment: unknown) =>
            segment &&
            typeof segment === "object" &&
            "text" in segment &&
            typeof segment.text === "string"
              ? segment.text
              : "",
          )
          .join("");
      }
    } catch {
      /* Old incomplete evidence: use precise word positions below. */
    }
  }
  return (
    variant.transcript
      .filter((segment) => !unit.speakerId || segment.speakerId === unit.speakerId)
      .flatMap((segment) => (segment.words?.length ? segment.words : [segment]))
      // Start ownership avoids duplicating an entire boundary-spanning word/legacy segment.
      .filter((part) => part.startMs >= unit.startMs && part.startMs < unit.endMs)
      .map((part) => part.text)
      .join("")
  );
}

const lexical = (text: string) => [...text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")];
export function carryoverEvidence(
  current: { text: string; startMs: number; endMs: number },
  previous?: { text: string; startMs: number; endMs: number },
) {
  const chars = lexical(current.text);
  const prior = lexical(previous?.text ?? "");
  // Character bigram Dice similarity, bounded linear work, not an automatic deduplicator.
  const pairs = (value: string[]) => value.slice(1).map((char, i) => value[i]! + char);
  const a = pairs(chars),
    b = pairs(prior);
  const counts = new Map<string, number>();
  for (const pair of b) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  let shared = 0;
  for (const pair of a)
    if ((counts.get(pair) ?? 0) > 0) {
      shared++;
      counts.set(pair, counts.get(pair)! - 1);
    }
  const previousUnitSimilarity = a.length + b.length ? (2 * shared) / (a.length + b.length) : 0;
  const duration = current.endMs - current.startMs;
  const audioRangeOverlapMs = previous
    ? Math.max(
        0,
        Math.min(current.endMs, previous.endMs) - Math.max(current.startMs, previous.startMs),
      )
    : 0;
  const possibleCarryover = Boolean(
    previous &&
    duration > 0 &&
    duration <= BENCHMARK_REVIEW_CONFIG.shortUnitMs &&
    current.startMs - previous.endMs <= BENCHMARK_REVIEW_CONFIG.previousUnitMaxGapMs &&
    chars.length >= BENCHMARK_REVIEW_CONFIG.carryoverMinCharacters &&
    chars.length / (duration / 1000) > BENCHMARK_REVIEW_CONFIG.carryoverCharactersPerSecond &&
    previousUnitSimilarity >= BENCHMARK_REVIEW_CONFIG.carryoverSimilarity,
  );
  return { possibleCarryover, previousUnitSimilarity, audioRangeOverlapMs };
}
