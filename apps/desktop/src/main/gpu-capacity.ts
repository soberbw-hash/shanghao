import { execFile } from "node:child_process";

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

type GpuReading = number | { free: number; total: number } | undefined;
export const queryGpu = (): Promise<GpuReading> =>
  new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 2_000, maxBuffer: 4_096 },
      (error, stdout) => {
        const free = error ? undefined : parseGpuFreeBytes(stdout);
        resolve(
          free === undefined
            ? undefined
            : { free, total: Number(stdout.split(",")[0]) * 1024 ** 2 },
        );
      },
    );
  });
