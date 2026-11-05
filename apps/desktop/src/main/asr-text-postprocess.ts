// Model control tokens only: never remove arbitrary <...> user content.
const CONTROL_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "fireredasr2-aed": ["<sil>"],
  // Retired provider: retained only for regression/evidence interpretation, not registration.
  "dolphin-cn-dialect-0.4b": ["<zh>", "<CN>", "<asr>", "<notimestamp>"],
};
export function cleanAsrText(provider: string, rawText: string): string {
  let text = rawText;
  for (const token of CONTROL_TOKENS[provider] ?? []) text = text.split(token).join("");
  if (Object.hasOwn(CONTROL_TOKENS, provider)) text = text.replaceAll("▁", " ");
  return text.replace(/\s+/gu, " ").trim();
}
export const hasAsrBody = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

export function validAsrSegments<
  T extends {
    startMs: number;
    endMs: number;
    text: string;
    words?: readonly { startMs: number; endMs: number }[];
  },
>(segments: T[], text: string, durationMs: number, requireTextMatch: boolean): T[] {
  return hasValidAsrAlignment(segments, durationMs) &&
    (!requireTextMatch || alignedTextMatches(text, segments))
    ? segments
    : [];
}

/** Reject the complete alignment if any boundary is invalid; callers retain the raw text. */
export function hasValidAsrAlignment(
  segments: readonly {
    startMs: number;
    endMs: number;
    words?: readonly { startMs: number; endMs: number }[];
  }[],
  durationMs: number,
): boolean {
  const valid = (item: { startMs: number; endMs: number }) =>
    Number.isFinite(item.startMs) &&
    Number.isFinite(item.endMs) &&
    item.startMs >= 0 &&
    item.endMs > item.startMs &&
    item.endMs <= durationMs;
  return (
    Number.isFinite(durationMs) &&
    durationMs > 0 &&
    segments.length > 0 &&
    segments.every(
      (segment) =>
        valid(segment) &&
        (segment.words ?? []).every(
          (word) => valid(word) && word.startMs >= segment.startMs && word.endMs <= segment.endMs,
        ),
    )
  );
}

export function alignedTextMatches(
  rawText: string,
  segments: readonly { text: string }[],
): boolean {
  const body = (text: string) =>
    [...text].filter((char) => /[\p{L}\p{N}\p{S}]/u.test(char)).join("");
  return (
    Boolean(body(rawText)) &&
    segments.length > 0 &&
    segments.every((segment) => Boolean(body(segment.text))) &&
    segments.map((segment) => body(segment.text)).join("") === body(rawText)
  );
}

/** Project only original punctuation/spacing onto aligned tokens after exact lexical agreement.
 * No guessed punctuation, rewritten words or changed timestamps. Mismatches stay untouched.
 */
export function restoreAlignedPunctuation<T extends { text: string }>(
  rawText: string,
  aligned: readonly T[],
): T[] {
  const body = (text: string) =>
    [...text].filter((char) => /[\p{L}\p{N}\p{S}]/u.test(char)).join("");
  if (!alignedTextMatches(rawText, aligned)) return [...aligned];
  const original = [...rawText];
  let cursor = 0;
  return aligned.map((part) => {
    const start = cursor;
    let remaining = [...body(part.text)].length;
    while (cursor < original.length && remaining > 0) {
      if (/[\p{L}\p{N}\p{S}]/u.test(original[cursor]!)) remaining--;
      cursor++;
    }
    while (cursor < original.length && !/[\p{L}\p{N}\p{S}]/u.test(original[cursor]!)) cursor++;
    return { ...part, text: original.slice(start, cursor).join("").trim() };
  });
}
