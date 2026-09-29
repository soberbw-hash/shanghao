import { AsyncLocalStorage } from "node:async_hooks";

interface JobWriteOwner {
  recordingId: string;
  version: number;
}

/** Carries a job's recording/version identity across awaited native and AI work. */
export class AiJobWriteOwnership {
  private readonly context = new AsyncLocalStorage<JobWriteOwner>();

  run<T>(recordingId: string, version: number, task: () => Promise<T>): Promise<T> {
    return this.context.run({ recordingId, version }, task);
  }

  assertCurrent(recordingId: string, currentVersion: number | undefined): void {
    const owner = this.context.getStore();
    if (!owner) return;
    if (owner.recordingId !== recordingId || owner.version !== currentVersion) {
      throw new Error("voice_memory_task_superseded");
    }
  }
}
