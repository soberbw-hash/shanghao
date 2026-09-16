import type { AsrPersistentWorker } from "./asr-persistent-worker";
import { gpuMemoryUsedMb } from "./asr-benchmark-runtime";

export async function measureAsrRelease(
  worker: Pick<AsrPersistentWorker, "releaseAndWait">,
  reason: string,
  baselineGpuMemoryMb?: number,
  sample = gpuMemoryUsedMb,
  wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  const startedAt = performance.now();
  const releaseRequestedAt = new Date().toISOString();
  const exit = await worker.releaseAndWait(reason);
  const memoryAfterWorkerExitMb = await sample();
  let gpuMemoryAfterReleaseMb = memoryAfterWorkerExitMb;
  const settleStartedAt = performance.now();
  // CUDA teardown can lag behind process exit. A brief plateau is not proof of a leak.
  for (let attempt = 0; attempt < 24 && gpuMemoryAfterReleaseMb !== undefined; attempt++) {
    if (baselineGpuMemoryMb !== undefined && gpuMemoryAfterReleaseMb <= baselineGpuMemoryMb + 128)
      break;
    if (baselineGpuMemoryMb === undefined && attempt >= 8) break;
    await wait(250);
    const current = await sample();
    if (current === undefined) break;
    gpuMemoryAfterReleaseMb = current;
  }
  const possibleResourceLeak =
    !exit.workerExited ||
    (baselineGpuMemoryMb !== undefined && gpuMemoryAfterReleaseMb !== undefined
      ? gpuMemoryAfterReleaseMb > baselineGpuMemoryMb + 256
      : undefined);
  return {
    gpuMemoryAfterReleaseMb,
    memoryAfterWorkerExitMb,
    releaseTimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
    resourceReleaseSucceeded: exit.workerExited && possibleResourceLeak !== true,
    possibleResourceLeak,
    releaseRequestedAt,
    workerExitedAt: exit.workerExited ? exit.workerExitedAt : undefined,
    releaseSampleDelayMs: Math.max(0, Math.round(performance.now() - settleStartedAt)),
  };
}
