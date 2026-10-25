import { AsyncLocalStorage } from "node:async_hooks";

interface JobWriteOwner {
  recordingId: string;
  version: number;
  savedRevision?: string;
}

export const isVoiceMemoryOwnershipError = (error: unknown): boolean =>
  error instanceof Error &&
  /^voice_memory_(?:shared_result_changed|task_superseded|room_changed|deleted)$/.test(
    error.message,
  );

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

  recordSaved(recordingId: string, revision: string): void {
    const owner = this.context.getStore();
    if (owner?.recordingId === recordingId) owner.savedRevision = revision;
  }

  ownsRevision(recordingId: string, revision: string): boolean {
    const owner = this.context.getStore();
    return owner?.recordingId === recordingId && owner.savedRevision === revision;
  }

  assertRevision(recordingId: string, revision: string): void {
    const owner = this.context.getStore();
    if (owner?.savedRevision !== undefined && !this.ownsRevision(recordingId, revision))
      throw new Error("voice_memory_shared_result_changed");
  }
}
