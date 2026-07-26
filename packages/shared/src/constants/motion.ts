export const APPLE_MOTION_SPRINGS = {
  soft: {
    stiffness: 300,
    damping: 30,
    mass: 0.72,
  },
  compact: {
    stiffness: 420,
    damping: 36,
    mass: 0.62,
  },
  physical: {
    stiffness: 340,
    damping: 28,
    mass: 0.78,
  },
} as const;

export const APPLE_MOTION_SPRING = APPLE_MOTION_SPRINGS.soft;

export const APPLE_MOTION_DURATION = {
  instant: 0.1,
  fast: 0.15,
  compact: 0.2,
  normal: 0.28,
  relaxed: 0.36,
  slow: 0.52,
  scene: 0.65,
  page: 0.36,
  panel: 0.28,
  message: 0.28,
  feedback: 0.15,
  icon: 0.2,
  color: 0.15,
  exit: 0.2,
} as const;

export const APPLE_MOTION_EASE = [0.22, 1, 0.36, 1] as const;
export const APPLE_MOTION_SPATIAL_EASE = [0.22, 1, 0.36, 1] as const;
export const APPLE_MOTION_IN_OUT_EASE = [0.4, 0, 0.2, 1] as const;
export const APPLE_MOTION_DRAWER_EASE = [0.32, 0.72, 0, 1] as const;
export const APPLE_MOTION_STANDARD_EASE = [0.2, 0, 0, 1] as const;
