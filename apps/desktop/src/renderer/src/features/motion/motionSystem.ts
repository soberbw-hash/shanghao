import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_DRAWER_EASE,
  APPLE_MOTION_EASE,
  APPLE_MOTION_IN_OUT_EASE,
  APPLE_MOTION_SPATIAL_EASE,
  APPLE_MOTION_SPRINGS,
  APPLE_MOTION_STANDARD_EASE,
} from "@private-voice/shared";

gsap.registerPlugin(CustomEase);
CustomEase.create("shanghao-out", "0.22,1,0.36,1");
CustomEase.create("shanghao-spatial", "0.22,1,0.36,1");
CustomEase.create("shanghao-in-out", "0.4,0,0.2,1");
CustomEase.create("shanghao-drawer", "0.32,0.72,0,1");
CustomEase.create("shanghao-jelly", "M0,0 C0.17,0.86 0.22,1.025 0.48,1.012 C0.7,1.002 0.86,1 1,1");

export const motionEase = {
  spatial: "shanghao-spatial",
  standard: "shanghao-out",
  feedback: "shanghao-out",
  inOut: "shanghao-in-out",
  drawer: "shanghao-drawer",
  jelly: "shanghao-jelly",
} as const;

export const motionDuration = APPLE_MOTION_DURATION;
export const motionSpring = APPLE_MOTION_SPRINGS;
export const motionCurve = {
  enter: APPLE_MOTION_EASE,
  move: APPLE_MOTION_IN_OUT_EASE,
  spatial: APPLE_MOTION_SPATIAL_EASE,
  drawer: APPLE_MOTION_DRAWER_EASE,
  standard: APPLE_MOTION_STANDARD_EASE,
} as const;

export const motionTransition = {
  page: { duration: motionDuration.page, ease: motionCurve.spatial },
  panel: { duration: motionDuration.panel, ease: motionCurve.enter },
  list: { type: "spring", ...motionSpring.soft },
  toast: { type: "spring", ...motionSpring.compact },
  overlay: { duration: motionDuration.compact, ease: motionCurve.enter },
  reduced: { duration: motionDuration.instant, ease: motionCurve.standard },
} as const;

export const configureMotionRuntime = (): void => {
  // GSAP follows requestAnimationFrame, so 120/144 Hz displays stay uncapped.
  gsap.config({
    autoSleep: 60,
    force3D: true,
    nullTargetWarn: false,
  });
  gsap.ticker.lagSmoothing(500, 33);

  const syncVisibility = () => {
    const hidden = document.visibilityState === "hidden";
    document.documentElement.classList.toggle("is-visual-runtime-hidden", hidden);
    if (hidden) gsap.ticker.sleep();
    else gsap.ticker.wake();
  };
  document.addEventListener("visibilitychange", syncVisibility);
  syncVisibility();
};
