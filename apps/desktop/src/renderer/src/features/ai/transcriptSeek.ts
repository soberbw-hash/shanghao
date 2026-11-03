import type { ReadableTranscriptParagraph } from "@private-voice/shared";

/** Remove only recognizable leaked ASR wire fields from the display, keeping the stored original. */
export function cleanTranscriptDisplay(text: string): string {
  // Limit matching work for unusually large stored segments.
  if (text.length > 10_000) return text;
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const rows: unknown = JSON.parse(trimmed);
      if (
        Array.isArray(rows) &&
        rows.length > 0 &&
        rows.every(
          (row: unknown) =>
            row !== null &&
            typeof row === "object" &&
            !Array.isArray(row) &&
            typeof (row as Record<string, unknown>).Start === "number" &&
            typeof (row as Record<string, unknown>).End === "number" &&
            typeof (row as Record<string, unknown>).Content === "string" &&
            (typeof (row as Record<string, unknown>).Speaker === "number" ||
              typeof (row as Record<string, unknown>).Speaker === "string"),
        )
      ) {
        return rows.map((row: { Content: string }) => row.Content).join("");
      }
    } catch {
      /* Preserve non-ASR text. */
    }
  }
  return text.replace(
    // eslint-disable-next-line security/detect-unsafe-regex
    /\{?\s*"?Start"?\s*:\s*\d+(?:\.\d+)?\s*,\s*"?End"?\s*:\s*\d+(?:\.\d+)?\s*,\s*"?Content"?\s*:\s*"([^"\\]*)"\s*,\s*"?Speaker"?\s*:\s*\d+\s*\}?[\]}]*/gi,
    (_match, content: string) => content,
  );
}
/** Match existing text to existing timing only. Never interpolate a word's timestamp. */
export function transcriptSeekRuns(
  paragraph: ReadableTranscriptParagraph,
): Array<{ text: string; startMs: number }> {
  const text = paragraph.text;
  const cleaned = cleanTranscriptDisplay(text);
  // Raw field offsets refer to the uncleaned wire text, not the displayed sentence.
  if (cleaned !== text) return [{ text: cleaned, startMs: paragraph.startMs }];
  const anchors: Array<{ index: number; startMs: number }> = [];
  let cursor = 0;
  const words = paragraph.words?.length ? paragraph.words : paragraph.sourceSegments;
  for (const word of words) {
    const token = word.text.trim();
    if (!token || !Number.isFinite(word.startMs)) continue;
    const index = text.indexOf(token, cursor);
    if (index < 0) continue;
    anchors.push({ index, startMs: word.startMs });
    cursor = index + token.length;
  }
  if (!anchors.length) return [{ text, startMs: paragraph.startMs }];
  const runs: Array<{ text: string; startMs: number }> = [];
  if (anchors[0]!.index > 0)
    runs.push({ text: text.slice(0, anchors[0]!.index), startMs: paragraph.startMs });
  for (const [index, anchor] of anchors.entries())
    runs.push({
      text: text.slice(anchor.index, anchors[index + 1]?.index ?? text.length),
      startMs: anchor.startMs,
    });
  return runs;
}
