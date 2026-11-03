export const recordingClipRange = (startMs: number, endMs: number, durationMs: number) => {
  if (
    ![startMs, endMs, durationMs].every(Number.isSafeInteger) ||
    startMs < 0 ||
    endMs > durationMs ||
    endMs <= startMs
  )
    throw new Error("clip_marker_out_of_range");
  if (endMs - startMs < 3_000 || endMs - startMs > 120_000) throw new Error("clip_invalid_window");
  return { startMs, endMs, durationMs: endMs - startMs };
};
