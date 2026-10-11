/** Optional warmup yields to the visible page; media and signaling never use this. */
export const waitForVisualIdle = (signal: AbortSignal, delayMs = 80): Promise<void> =>
  new Promise((resolve, reject) => {
    let timer: number | undefined;
    let idle: number | undefined;
    const cancelScheduled = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      timer = idle = undefined;
    };
    const clean = () => {
      cancelScheduled();
      signal.removeEventListener("abort", abort);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
      window.removeEventListener("blur", schedule);
      window.removeEventListener("pointerdown", schedule);
      window.removeEventListener("keydown", schedule);
    };
    const abort = () => {
      clean();
      reject(new DOMException("Visual warmup cancelled", "AbortError"));
    };
    const visible = () => document.visibilityState !== "hidden" && document.hasFocus();
    const finish = () => {
      if (signal.aborted) return abort();
      if (!visible()) return schedule();
      clean();
      resolve();
    };
    const schedule = () => {
      cancelScheduled();
      if (signal.aborted) return abort();
      if (!visible()) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (window.requestIdleCallback) {
          // No forced timeout: optional preparation must not interrupt a busy frame.
          idle = window.requestIdleCallback((deadline) => {
            idle = undefined;
            if (deadline.timeRemaining() < 4) schedule();
            else finish();
          });
        } else finish();
      }, delayMs);
    };
    signal.addEventListener("abort", abort, { once: true });
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    window.addEventListener("pointerdown", schedule, { passive: true });
    window.addEventListener("keydown", schedule);
    schedule();
  });
