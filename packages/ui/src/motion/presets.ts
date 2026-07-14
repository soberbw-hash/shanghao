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
  whileTap: { scale: 0.965, y: 0 },
  whileHover: { scale: 1.012, y: -1 },
  transition: { type: "spring", ...APPLE_MOTION_SPRING },
};
