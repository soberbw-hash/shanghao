import { queryGpu } from "./gpu-capacity";
export { parseGpuFreeBytes } from "./gpu-capacity";
import { cpus, freemem } from "node:os";

export interface HostResourceCapacity {
  availableMemoryBytes: number;
  cpuBusyRatio?: number;
  gpuTotalBytes?: number;
  gpuFreeBytes?: number;
  sampledAt: number;
}

const cpuCounters = () =>
  cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );

/** Demand-only, coalesced sampling. No startup CUDA import, interval or permanent subprocess. */
export class HostCapacitySampler {
  private previous?: ReturnType<typeof cpuCounters>;
  private snapshot: HostResourceCapacity = { availableMemoryBytes: freemem(), sampledAt: 0 };
  private pending?: Promise<void>;
  constructor(
    private readonly readCpu = cpuCounters,
    private readonly readMemory = freemem,
    private readonly readGpu = queryGpu,
    private readonly now = Date.now,
    private readonly ttlMs = 15_000,
  ) {}

  current(): HostResourceCapacity {
    return { ...this.snapshot, availableMemoryBytes: this.readMemory() };
  }

  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.snapshot.sampledAt && this.now() - this.snapshot.sampledAt < this.ttlMs)
      return Promise.resolve();
    const counters = this.readCpu();
    const elapsed = this.previous ? counters.total - this.previous.total : 0;
    const idle = this.previous ? counters.idle - this.previous.idle : 0;
    this.previous = counters;
    this.pending = Promise.resolve()
      .then(this.readGpu)
      .catch(() => undefined)
      .then((gpu) => {
        this.snapshot = {
          availableMemoryBytes: this.readMemory(),
          gpuFreeBytes: typeof gpu === "number" ? gpu : gpu?.free,
          gpuTotalBytes: typeof gpu === "object" ? gpu.total : undefined,
          cpuBusyRatio: elapsed > 0 ? Math.max(0, Math.min(1, 1 - idle / elapsed)) : undefined,
          sampledAt: this.now(),
        };
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
}

export const hostCapacitySampler = new HostCapacitySampler();
