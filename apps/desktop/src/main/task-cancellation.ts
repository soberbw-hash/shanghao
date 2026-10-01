import { setTimeout as delay } from "node:timers/promises";

/** Settles immediately on cancellation and lets Node own timer/listener cleanup. */
export async function waitForTask(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error("ai_task_paused");
  try {
    await delay(delayMs, undefined, { signal });
  } catch (error) {
    if (signal?.aborted) throw new Error("ai_task_paused", { cause: error });
    throw error;
  }
}

/** Cancel one caller's wait without cancelling work owned by another caller. */
export function awaitTask<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 90_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(new Error("ai_task_paused")));
    const timer = setTimeout(
      () => finish(() => reject(new Error("background_resource_wait_timeout"))),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    void operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}
