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

/** Project only original punctuation/spacing onto aligned tokens after exact lexical agreement.
 * No guessed punctuation, rewritten words or changed timestamps. Mismatches stay untouched.
 */
export function restoreAlignedPunctuation<T extends { text: string }>(
  rawText: string,
  aligned: readonly T[],
): T[] {
  const body = (text: string) =>
    [...text].filter((char) => /[\p{L}\p{N}\p{S}]/u.test(char)).join("");
  if (
    !aligned.length ||
    !body(rawText) ||
    aligned.some((part) => !body(part.text)) ||
    aligned.map((part) => body(part.text)).join("") !== body(rawText)
  )
    return [...aligned];
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
