import type { VoiceMemoryTranscriptSegment } from "@private-voice/shared";

export const normalizedFusionText = (text: string) => text.replace(/[\p{P}\p{Z}\s]/gu, "");
export const fusionSegmentsOverlap = (
  a: VoiceMemoryTranscriptSegment,
  b: VoiceMemoryTranscriptSegment,
) =>
  a.startMs < b.endMs &&
  b.startMs < a.endMs &&
  (!a.memberId || !b.memberId || a.memberId === b.memberId);

/** Preserve every cloud character not literally accounted for by a matching local sentence.
 * Time overlap alone cannot prove text coverage. Unmatched fragments remain explicitly uncertain.
 */
export function retainUncoveredCloudText(
  cloud: VoiceMemoryTranscriptSegment[],
  local: VoiceMemoryTranscriptSegment[],
): VoiceMemoryTranscriptSegment[] {
  const originals = local.filter((segment) => !segment.fusionEstimated);
  const extra: VoiceMemoryTranscriptSegment[] = [];
  for (const source of cloud) {
    const text = normalizedFusionText(source.text);
    const positions = [...source.text.matchAll(/[^\p{P}\p{Z}\s]/gu)].flatMap((match) =>
      Array<number>(match[0].length).fill(match.index!),
    );
    const covered = new Uint8Array(text.length);
    for (const row of originals) {
      if (!fusionSegmentsOverlap(row, source)) continue;
      const phrase = normalizedFusionText(row.text);
      if (!phrase) continue;
      let start = text.indexOf(phrase);
      while (start >= 0 && covered.subarray(start, start + phrase.length).some(Boolean))
        start = text.indexOf(phrase, start + 1);
      if (start >= 0) covered.fill(1, start, start + phrase.length);
    }
    for (let start = 0; start < covered.length;) {
      if (covered[start]) {
        start++;
        continue;
      }
      let end = start + 1;
      while (end < covered.length && !covered[end]) end++;
      const remainder = source.text
        .slice(positions[start], positions[end] ?? source.text.length)
        .trim();
      if (remainder)
        extra.push({
          ...source,
          speakerId: source.memberId ? source.speakerId : `fusion-cloud:${source.speakerId}`,
          id: `fusion-cloud:${source.id}:${start}-${end}`,
          text: remainder,
          words: undefined,
          fusionUncertain: true,
          fusionEstimated: true,
        });
      start = end;
    }
  }
  return [...originals, ...extra].sort((a, b) => a.startMs - b.startMs);
}
