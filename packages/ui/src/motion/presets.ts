import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  APPLE_MOTION_SPRING,
} from "@private-voice/shared";

export const fadeSlideUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 8 },
  transition: { duration: APPLE_MOTION_DURATION.feedback, ease: APPLE_MOTION_EASE },
};

export const gentleScale = {
  // Keep feedback tactile without making the control visibly jump in size.
  whileTap: { scale: 0.985, y: 0 },
  whileHover: { scale: 1.006, y: -1 },
  transition: { type: "spring", ...APPLE_MOTION_SPRING },
};
