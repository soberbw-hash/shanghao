import { gsap } from "gsap";

import { APPLE_MOTION_DURATION } from "@private-voice/shared";

export const motionEase = {
  spatial: "power3.out",
  standard: "power3.out",
  feedback: "power2.out",
} as const;

export const motionDuration = APPLE_MOTION_DURATION;

export const configureMotionRuntime = (): void => {
  // GSAP follows requestAnimationFrame, so 120/144 Hz displays stay uncapped.
  gsap.config({
    autoSleep: 60,
    force3D: true,
    nullTargetWarn: false,
  });
  gsap.ticker.lagSmoothing(500, 33);
};
