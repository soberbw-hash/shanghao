import type { ReadableTranscriptParagraph } from "@private-voice/shared";
/** Match existing text to existing timing only. Never interpolate a word's timestamp. */
export function transcriptSeekRuns(
  paragraph: ReadableTranscriptParagraph,
): Array<{ text: string; startMs: number }> {
  const text = paragraph.text;
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
