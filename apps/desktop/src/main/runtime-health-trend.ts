import type { RuntimeHealthSnapshot } from "@private-voice/shared";

export interface RuntimeHealthTrend {
  sampleCount: number;
  windowMs: number;
  warnings: string[];
}

const MAX_ANALYSIS_SAMPLES = 360;
const MAX_SAMPLE_GAP_MS = 3 * 60_000;
const MIN_TREND_WINDOW_MS = 3 * 60_000;

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
};

const phaseKey = (sample: RuntimeHealthSnapshot): string =>
  [
    sample.main.pid,
    sample.renderer?.pid,
    sample.realtime.phaseId ?? "legacy",
    sample.realtime.roomId,
    sample.realtime.roomLifecycleState,
    sample.realtime.peerCount,
    sample.realtime.screenShareActive,
    sample.realtime.phoneMicStatus,
  ].join("|");

const sustainedGrowth = (
  samples: readonly RuntimeHealthSnapshot[],
  read: (sample: RuntimeHealthSnapshot) => number | undefined,
  threshold: number,
): boolean => {
  const third = Math.floor(samples.length / 3);
  const thirds = [samples.slice(0, third), samples.slice(third, -third), samples.slice(-third)];
  const values = thirds.map((part) =>
    median(part.map(read).filter((value): value is number => value !== undefined)),
  );
  const [early, middle, late] = values;
  return (
    early !== undefined &&
    middle !== undefined &&
    late !== undefined &&
    late - early >= threshold &&
    middle - early >= threshold * 0.2 &&
    late - middle >= threshold * 0.2
  );
};

/** Compares medians only within the latest stable room/device phase. */
export const analyzeRuntimeHealthTrend = (
  samples: readonly RuntimeHealthSnapshot[],
): RuntimeHealthTrend => {
  const recent = samples.slice(-MAX_ANALYSIS_SAMPLES);
  const last = recent.at(-1);
  if (!last) return { sampleCount: 0, windowMs: 0, warnings: [] };
  const key = phaseKey(last);
  let start = recent.length - 1;
  while (start > 0) {
    const previous = recent[start - 1];
    const current = recent[start];
    if (
      !previous ||
      !current ||
      phaseKey(previous) !== key ||
      Date.parse(current.capturedAt) - Date.parse(previous.capturedAt) > MAX_SAMPLE_GAP_MS
    ) {
      break;
    }
    start -= 1;
  }
  const stable = recent.slice(start);
  const windowMs = Math.max(
    0,
    Date.parse(last.capturedAt) - Date.parse(stable[0]?.capturedAt ?? last.capturedAt),
  );
  if (stable.length < 9 || windowMs < MIN_TREND_WINDOW_MS) {
    return { sampleCount: stable.length, windowMs, warnings: [] };
  }
  const warnings: string[] = [];
  const metrics: Array<[string, (sample: RuntimeHealthSnapshot) => number | undefined, number]> = [
    ["main_working_set_growth", (sample) => sample.main.workingSetBytes, 64 * 1024 * 1024],
    ["renderer_working_set_growth", (sample) => sample.renderer?.workingSetBytes, 96 * 1024 * 1024],
    ["child_process_growth", (sample) => sample.processes.length, 2],
    ["dom_node_growth", (sample) => sample.renderer?.domNodeCount, 500],
    ["media_track_growth", (sample) => sample.realtime.trackCount, 4],
    ["audio_context_growth", (sample) => sample.realtime.audioContextCount, 1],
    ["audio_node_growth", (sample) => sample.realtime.audioNodeCount, 8],
    ["timer_growth", (sample) => sample.realtime.timerCount, 8],
    ["listener_growth", (sample) => sample.realtime.listenerCount, 16],
  ];
  for (const [name, read, threshold] of metrics) {
    if (sustainedGrowth(stable, read, threshold)) warnings.push(name);
  }
  return { sampleCount: stable.length, windowMs, warnings };
};
