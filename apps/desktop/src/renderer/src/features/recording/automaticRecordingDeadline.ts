/** The React effect owns one absence interval. A new companion or room disposes it. */
export function automaticRecordingDeadline(
  clock: Pick<typeof window, "setTimeout" | "clearTimeout">,
  stillAlone: () => boolean,
  save: () => void,
  now = Date.now(),
) {
  const delay = 5 * 60_000;
  let active = true;
  const timer = clock.setTimeout(() => {
    if (!active) return;
    active = false;
    if (stillAlone()) save();
  }, delay);
  return {
    expires: now + delay,
    cancel() {
      active = false;
      clock.clearTimeout(timer);
    },
  };
}
