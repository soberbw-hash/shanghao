interface GlassPointerState {
  bounds: DOMRect;
  frame: number | undefined;
  clientX: number;
  clientY: number;
  resizeObserver?: ResizeObserver;
}

const pointerStates = new WeakMap<HTMLElement, GlassPointerState>();

const ensureState = (element: HTMLElement): GlassPointerState => {
  const existing = pointerStates.get(element);
  if (existing) return existing;
  const state: GlassPointerState = {
    bounds: element.getBoundingClientRect(),
    frame: undefined,
    clientX: 0,
    clientY: 0,
  };
  if (typeof ResizeObserver !== "undefined") {
    state.resizeObserver = new ResizeObserver(() => {
      state.bounds = element.getBoundingClientRect();
    });
    state.resizeObserver.observe(element);
  }
  pointerStates.set(element, state);
  return state;
};

export const refreshGlassPointerHighlightBounds = (element: HTMLElement): void => {
  const state = ensureState(element);
  state.bounds = element.getBoundingClientRect();
};

export const updateGlassPointerHighlight = (
  element: HTMLElement,
  clientX: number,
  clientY: number,
): void => {
  const state = ensureState(element);
  state.clientX = clientX;
  state.clientY = clientY;
  if (state.frame !== undefined) return;
  state.frame = window.requestAnimationFrame(() => {
    state.frame = undefined;
    element.style.setProperty("--glass-pointer-x", `${state.clientX - state.bounds.left}px`);
    element.style.setProperty("--glass-pointer-y", `${state.clientY - state.bounds.top}px`);
    element.dataset.glassPointerActive = "true";
  });
};

export const clearGlassPointerHighlight = (element: HTMLElement): void => {
  const state = pointerStates.get(element);
  if (state?.frame !== undefined) window.cancelAnimationFrame(state.frame);
  state?.resizeObserver?.disconnect();
  pointerStates.delete(element);
  delete element.dataset.glassPointerActive;
};
