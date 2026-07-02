export const APPLE_MOTION_SPRING = {
  stiffness: 360,
  damping: 30,
  mass: 0.55,
} as const;

export const APPLE_MOTION_DURATION = {
  page: 0.34,
  panel: 0.26,
  feedback: 0.15,
  color: 0.13,
} as const;

export const APPLE_MOTION_EASE = [0.22, 1, 0.36, 1] as const;
