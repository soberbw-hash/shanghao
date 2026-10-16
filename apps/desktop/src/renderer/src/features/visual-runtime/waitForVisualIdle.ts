let roomBusy = false;
let currentRoute: string | undefined;
let transitionSettledAt = 0;
const activityListeners = new Set<() => void>();

/** Called by the app shell; optional loaders never import the media/store graph. */
export const updateVisualWarmupActivity = (busy: boolean, route: string): void => {
  if (roomBusy === busy && currentRoute === route) return;
  roomBusy = busy;
  currentRoute = route;
  transitionSettledAt = performance.now() + 1_200;
  activityListeners.forEach((listener) => listener());
};

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
      activityListeners.delete(schedule);
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
    const visible = () => document.visibilityState !== "hidden" && document.hasFocus() && !roomBusy;
    const finish = () => {
      if (signal.aborted) return abort();
      if (!visible()) return schedule();
      if (performance.now() < transitionSettledAt) return schedule();
      clean();
      resolve();
    };
    const schedule = () => {
      cancelScheduled();
      if (signal.aborted) return abort();
      if (!visible()) return;
      timer = window.setTimeout(
        () => {
          timer = undefined;
          if (window.requestIdleCallback) {
            // No forced timeout: optional preparation must not interrupt a busy frame.
            idle = window.requestIdleCallback((deadline) => {
              idle = undefined;
              if (deadline.timeRemaining() < 4) schedule();
              else finish();
            });
          } else finish();
        },
        Math.max(delayMs, transitionSettledAt - performance.now()),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    window.addEventListener("blur", schedule);
    window.addEventListener("pointerdown", schedule, { passive: true });
    window.addEventListener("keydown", schedule);
    activityListeners.add(schedule);
    schedule();
  });
