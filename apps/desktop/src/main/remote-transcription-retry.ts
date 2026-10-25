import { waitForTask } from "./task-cancellation";

export const isTransientRemoteTranscriptionError = (reason: string): boolean =>
  /^(?:cloud|custom)_asr_(?:http_(?:408|429|5\d\d)|network_error|timeout)$/.test(reason);

/** Retry only transient service responses, keeping credentials/billing failures fail-fast. */
export async function transcribeRemoteWithRetry<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new Error("ai_task_paused");
    try {
      const result = await operation();
      if (signal.aborted) throw new Error("ai_task_paused");
      return result;
    } catch (error) {
      if (signal.aborted) throw new Error("ai_task_paused", { cause: error });
      const message = error instanceof Error ? error.message : "";
      if (attempt >= 2 || !isTransientRemoteTranscriptionError(message)) {
        throw error;
      }
      await waitForTask(1_000 * (attempt + 1), signal);
    }
  }
}
