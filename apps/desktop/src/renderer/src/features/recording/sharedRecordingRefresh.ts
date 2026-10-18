/** Refresh shared disk data while this view is visible; never overlap requests. */
export const subscribeSharedRecordingRefresh = (refresh: () => Promise<void>): (() => void) => {
  let active = true;
  let pending = false;
  const run = () => {
    if (!active || pending || document.visibilityState === "hidden") return;
    pending = true;
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        pending = false;
      });
  };
  window.addEventListener("focus", run);
  document.addEventListener("visibilitychange", run);
  const timer = window.setInterval(run, 10_000);
  return () => {
    active = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", run);
    document.removeEventListener("visibilitychange", run);
  };
};
