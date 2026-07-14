export const APPLE_MOTION_SPRING = {
  stiffness: 300,
  damping: 28,
  mass: 0.68,
} as const;

export const APPLE_MOTION_DURATION = {
  page: 0.48,
  panel: 0.36,
  scene: 0.72,
  message: 0.32,
  feedback: 0.22,
  icon: 0.28,
  color: 0.16,
  exit: 0.3,
} as const;

export const APPLE_MOTION_EASE = [0.16, 1, 0.3, 1] as const;
export const APPLE_MOTION_SPATIAL_EASE = [0.22, 1, 0.36, 1] as const;
export const APPLE_MOTION_IN_OUT_EASE = [0.45, 0, 0.55, 1] as const;
