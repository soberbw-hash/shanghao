import type { VoiceMemoryRecord } from "@private-voice/shared";

// IPC structured-clones snapshots. Compare only the expensive read-only subtrees;
// never substitute stale timestamps/words just because visible text is unchanged.
const equal = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && equal(left[key], right[key]))
  );
};

export function reuseVoiceMemoryReferences(
  previous: VoiceMemoryRecord | undefined,
  next: VoiceMemoryRecord | undefined,
) {
  if (!previous || !next || previous.recordingId !== next.recordingId) return next;
  return {
    ...next,
    transcript: equal(previous.transcript, next.transcript) ? previous.transcript : next.transcript,
    speakers: equal(previous.speakers, next.speakers) ? previous.speakers : next.speakers,
  };
}
