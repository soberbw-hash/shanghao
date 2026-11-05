import type { KnownSpeakerTranscriptionSource } from "./speaker-transcript";
import type {
  VoiceMemoryUnexaminedRange,
  VoiceMemoryTranscriptionStats,
} from "@private-voice/shared";

export const savedUnexaminedCoverage = (stats?: VoiceMemoryTranscriptionStats) => ({
  unexaminedParticipantAudioMs: stats?.unexaminedParticipantAudioMs,
  unexaminedParticipantAudioRanges: stats?.unexaminedParticipantAudioRanges,
  unexaminedRangesTruncated: stats?.unexaminedRangesTruncated,
});

const MAX_REVIEW_RANGES = 128;

/** Compare planned work with each recorded member track, not wall-clock room duration.
 * Gaps are unexamined audio, not evidence that speech was missed.
 */
export function unexaminedParticipantAudio(
  tracks: readonly KnownSpeakerTranscriptionSource[],
  planned: readonly KnownSpeakerTranscriptionSource[],
):
  | {
      unexaminedParticipantAudioMs: number;
      unexaminedParticipantAudioRanges: VoiceMemoryUnexaminedRange[];
      unexaminedRangesTruncated: boolean;
    }
  | undefined {
  if (!tracks.length || tracks.some((track) => !track.accountIdentity)) return undefined;
  // Legacy clips without a durable identity cannot safely be attributed to a member.
  if (planned.some((source) => !source.accountIdentity)) return undefined;
  const byMember = new Map<string, Array<[number, number]>>();
  for (const source of planned) {
    if (source.endMs <= source.startMs) continue;
    const id = source.accountIdentity!;
    const intervals = byMember.get(id) ?? [];
    intervals.push([source.startMs, source.endMs]);
    byMember.set(id, intervals);
  }
  for (const [id, intervals] of byMember) {
    intervals.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of intervals) {
      const previous = merged.at(-1);
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    }
    byMember.set(id, merged);
  }
  let missing = 0;
  const ranges: VoiceMemoryUnexaminedRange[] = [];
  let truncated = false;
  const addGap = (track: KnownSpeakerTranscriptionSource, startMs: number, endMs: number) => {
    if (endMs <= startMs) return;
    missing += endMs - startMs;
    const previous = ranges.at(-1);
    if (previous && previous.memberId === track.accountIdentity && previous.endMs === startMs) {
      previous.endMs = endMs;
    } else if (ranges.length < MAX_REVIEW_RANGES) {
      ranges.push({
        memberId: track.accountIdentity!,
        displayName: track.displayNameSnapshot,
        startMs,
        endMs,
      });
    } else truncated = true;
  };
  for (const track of tracks) {
    let cursor = track.startMs;
    const intervals = byMember.get(track.accountIdentity!) ?? [];
    let low = 0;
    let high = intervals.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (intervals[middle]![1] <= cursor) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < intervals.length; index += 1) {
      const [start, end] = intervals[index]!;
      if (end <= cursor) continue;
      if (start >= track.endMs) break;
      if (start > cursor) addGap(track, cursor, Math.min(start, track.endMs));
      cursor = Math.max(cursor, Math.min(end, track.endMs));
      if (cursor >= track.endMs) break;
    }
    addGap(track, cursor, track.endMs);
  }
  return {
    unexaminedParticipantAudioMs: missing,
    unexaminedParticipantAudioRanges: ranges,
    unexaminedRangesTruncated: truncated,
  };
}

export const unexaminedParticipantAudioMs = (
  tracks: readonly KnownSpeakerTranscriptionSource[],
  planned: readonly KnownSpeakerTranscriptionSource[],
): number | undefined => unexaminedParticipantAudio(tracks, planned)?.unexaminedParticipantAudioMs;
