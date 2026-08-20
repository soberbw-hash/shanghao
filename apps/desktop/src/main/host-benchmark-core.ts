export interface HostBenchmarkSample {
  host: "electron" | "tauri";
  capturedAt: string;
  uptimeMs: number;
  cpuPercent: number;
  residentMemoryBytes: number;
  heapUsedBytes: number;
  displayRefreshRateHz: number;
  gpuFeatureStatus: Record<string, string>;
}

export interface HostBenchmarkSummary {
  sampleCount: number;
  cpuP50: number;
  cpuP95: number;
  residentMemoryP50Bytes: number;
  residentMemoryP95Bytes: number;
}

const percentile = (values: number[], percentileValue: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[Math.max(0, index)] ?? 0;
};

export const summarizeHostBenchmark = (
  samples: readonly HostBenchmarkSample[],
): HostBenchmarkSummary => ({
  sampleCount: samples.length,
  cpuP50: percentile(
    samples.map((sample) => sample.cpuPercent),
    0.5,
  ),
  cpuP95: percentile(
    samples.map((sample) => sample.cpuPercent),
    0.95,
  ),
  residentMemoryP50Bytes: percentile(
    samples.map((sample) => sample.residentMemoryBytes),
    0.5,
  ),
  residentMemoryP95Bytes: percentile(
    samples.map((sample) => sample.residentMemoryBytes),
    0.95,
  ),
});
