import { app, screen } from "electron";

import type { HostBenchmarkSample } from "./host-benchmark-core";

export * from "./host-benchmark-core";

export const captureElectronHostSample = (): HostBenchmarkSample => {
  const memory = process.memoryUsage();
  const cpu = process.getCPUUsage();
  const display = screen.getPrimaryDisplay();
  return {
    host: "electron",
    capturedAt: new Date().toISOString(),
    uptimeMs: Math.round(process.uptime() * 1_000),
    cpuPercent: cpu.percentCPUUsage,
    residentMemoryBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    displayRefreshRateHz: display.displayFrequency || 0,
    gpuFeatureStatus: Object.fromEntries(Object.entries(app.getGPUFeatureStatus())),
  };
};
