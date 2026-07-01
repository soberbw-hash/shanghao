import { gsap } from "gsap";

export const motionEase = {
  spatial: "expo.out",
  standard: "power4.out",
  feedback: "back.out(1.22)",
} as const;

export const motionDuration = {
  page: 0.46,
  panel: 0.36,
  feedback: 0.2,
} as const;

export const configureMotionRuntime = (): void => {
  // GSAP follows requestAnimationFrame, so 120/144 Hz displays stay uncapped.
  gsap.config({
    autoSleep: 60,
    force3D: true,
    nullTargetWarn: false,
  });
  gsap.ticker.lagSmoothing(500, 33);
};
