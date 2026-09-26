import type { RuntimeHealthSnapshot } from "@private-voice/shared";

export interface RuntimeHealthTrend {
  sampleCount: number;
  windowMs: number;
  warnings: string[];
}

const grewBy = (first: number | undefined, last: number | undefined, amount: number): boolean =>
  first !== undefined && last !== undefined && last - first >= amount;

/** Detects sustained resource growth across a stable room shape without guessing audio quality. */
export const analyzeRuntimeHealthTrend = (
  samples: readonly RuntimeHealthSnapshot[],
): RuntimeHealthTrend => {
  const usable = samples.slice(-60);
  const first = usable[0];
  const last = usable.at(-1);
  if (!first || !last || usable.length < 6) {
    return { sampleCount: usable.length, windowMs: 0, warnings: [] };
  }

  const warnings: string[] = [];
  const stableRealtimeShape =
    first.realtime.peerCount === last.realtime.peerCount &&
    first.realtime.screenShareActive === last.realtime.screenShareActive;
  if (grewBy(first.main.workingSetBytes, last.main.workingSetBytes, 64 * 1024 * 1024)) {
    warnings.push("main_working_set_growth");
  }
  if (grewBy(first.renderer?.workingSetBytes, last.renderer?.workingSetBytes, 96 * 1024 * 1024)) {
    warnings.push("renderer_working_set_growth");
  }
  if (last.processes.length - first.processes.length >= 2) {
    warnings.push("child_process_growth");
  }
  if (stableRealtimeShape) {
    if (grewBy(first.renderer?.domNodeCount, last.renderer?.domNodeCount, 500)) {
      warnings.push("dom_node_growth");
    }
    const counters = [
      ["media_track_growth", first.realtime.trackCount, last.realtime.trackCount, 4],
      [
        "audio_context_growth",
        first.realtime.audioContextCount,
        last.realtime.audioContextCount,
        1,
      ],
      ["audio_node_growth", first.realtime.audioNodeCount, last.realtime.audioNodeCount, 8],
      ["timer_growth", first.realtime.timerCount, last.realtime.timerCount, 8],
      ["listener_growth", first.realtime.listenerCount, last.realtime.listenerCount, 16],
    ] as const;
    for (const [name, start, end, threshold] of counters) {
      if (start !== undefined && end !== undefined && end - start >= threshold) warnings.push(name);
    }
  }

  return {
    sampleCount: usable.length,
    windowMs: Math.max(0, Date.parse(last.capturedAt) - Date.parse(first.capturedAt)),
    warnings,
  };
};
