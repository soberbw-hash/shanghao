import { execFile } from "node:child_process";
import { cpus, freemem } from "node:os";

export interface HostResourceCapacity {
  availableMemoryBytes: number;
  cpuBusyRatio?: number;
  gpuFreeBytes?: number;
  sampledAt: number;
}

export const parseGpuFreeBytes = (output: string): number | undefined => {
  // Runtimes use CUDA device 0. Never sum unrelated GPUs into its capacity.
  const fields = output.trim().split(/\r?\n/u)[0]?.split(",");
  if (fields?.length !== 2 || fields.some((field) => !field.trim())) return undefined;
  const values = fields.map(Number);
  const [total = Number.NaN, free = Number.NaN] = values ?? [];
  return Number.isFinite(total) && Number.isFinite(free) && total > 0 && free >= 0 && free <= total
    ? free * 1024 ** 2
    : undefined;
};

const cpuCounters = () =>
  cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );

const queryGpu = (): Promise<number | undefined> =>
  new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 2_000, maxBuffer: 4_096 },
      (error, stdout) => resolve(error ? undefined : parseGpuFreeBytes(stdout)),
    );
  });

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
      .then((gpuFreeBytes) => {
        this.snapshot = {
          availableMemoryBytes: this.readMemory(),
          gpuFreeBytes,
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
