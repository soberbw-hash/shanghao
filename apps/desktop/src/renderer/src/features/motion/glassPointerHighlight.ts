export const updateGlassPointerHighlight = (
  element: HTMLElement,
  clientX: number,
  clientY: number,
): void => {
  const bounds = element.getBoundingClientRect();
  element.style.setProperty("--glass-pointer-x", `${clientX - bounds.left}px`);
  element.style.setProperty("--glass-pointer-y", `${clientY - bounds.top}px`);
  element.dataset.glassPointerActive = "true";
};

export const clearGlassPointerHighlight = (element: HTMLElement): void => {
  delete element.dataset.glassPointerActive;
};
