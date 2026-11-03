let active = 0,
  revision = 0;
const listeners = new Set<() => void>();
const notify = () => {
  revision++;
  for (const listener of listeners) listener();
};

/** Device changes inside one status operation get one semantic cue instead of mic + speaker clicks. */
export function beginAvailabilitySoundTransition(): () => void {
  active++;
  notify();
  let ended = false;
  return () => {
    if (!ended) {
      ended = true;
      active--;
      notify();
    }
  };
}
export const readAvailabilitySoundTransition = () => ({ active: active > 0, revision });
export const subscribeAvailabilitySoundTransition = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
