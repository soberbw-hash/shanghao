export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayWorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EDGE_GAP = 6;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, maximum));

export const clampOverlayTop = (
  desiredTopY: number,
  height: number,
  workArea: OverlayWorkArea,
): number => {
  const minimum = workArea.y + EDGE_GAP;
  const maximum = Math.max(minimum, workArea.y + workArea.height - height - EDGE_GAP);
  return clamp(Math.round(desiredTopY), minimum, maximum);
};

export const centerOverlayTop = (height: number, workArea: OverlayWorkArea): number =>
  clampOverlayTop(workArea.y + Math.round((workArea.height - height) / 2), height, workArea);

export const snapOverlayTop = (
  desiredTopY: number,
  height: number,
  workArea: OverlayWorkArea,
  gridSize: number,
): number => {
  const snappedTop = workArea.y + Math.round((desiredTopY - workArea.y) / gridSize) * gridSize;
  return clampOverlayTop(snappedTop, height, workArea);
};

/**
 * Member rows grow downwards from a stable top edge. Repeated state pushes therefore
 * cannot slowly walk the native window across the screen.
 */
export const resizeOverlayKeepingTop = (
  current: OverlayBounds,
  height: number,
  workArea: OverlayWorkArea,
  snapX: number,
  width: number,
): OverlayBounds => ({
  x: snapX,
  y: clampOverlayTop(current.y, height, workArea),
  width,
  height,
});

export const isPointInsideOverlay = (
  point: { x: number; y: number },
  bounds: OverlayBounds,
): boolean =>
  point.x >= bounds.x &&
  point.x < bounds.x + bounds.width &&
  point.y >= bounds.y &&
  point.y < bounds.y + bounds.height;
