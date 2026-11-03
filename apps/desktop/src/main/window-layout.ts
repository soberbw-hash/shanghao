export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Treat saved geometry as untrusted input without changing the user's file. */
export function normalizeSavedWindowBounds(value: unknown): Partial<WindowRectangle> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const bounds: Partial<WindowRectangle> = {};
  for (const key of ["x", "y", "width", "height"] as const) {
    const item = raw[key];
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      ((key === "width" || key === "height") && item <= 0)
    )
      continue;
    const rounded = Math.round(item);
    if (
      !Number.isSafeInteger(rounded) ||
      Math.abs(rounded) > 2_147_483_647 ||
      ((key === "width" || key === "height") && rounded < 1)
    )
      continue;
    bounds[key] = rounded;
  }
  return bounds;
}

/** Electron display and window bounds are already in device-independent pixels. */
export function fitMainWindow(work: WindowRectangle, saved: Partial<WindowRectangle>) {
  const minWidth = Math.min(1120, work.width);
  const minHeight = Math.min(720, work.height);
  const defaultWidth = Math.min(1680, Math.max(minWidth, Math.round(work.width * 0.88)));
  const defaultHeight = Math.min(1050, Math.max(minHeight, Math.round(work.height * 0.88)));
  const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  const width =
    valid(saved.width) && saved.width > 0 && saved.width <= work.width
      ? Math.max(minWidth, saved.width)
      : defaultWidth;
  const height =
    valid(saved.height) && saved.height > 0 && saved.height <= work.height
      ? Math.max(minHeight, saved.height)
      : defaultHeight;
  const x = Math.min(
    work.x + work.width - width,
    Math.max(work.x, valid(saved.x) ? saved.x : work.x + Math.round((work.width - width) / 2)),
  );
  const y = Math.min(
    work.y + work.height - height,
    Math.max(work.y, valid(saved.y) ? saved.y : work.y + Math.round((work.height - height) / 2)),
  );
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    minWidth,
    minHeight,
  };
}
