import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

import { APPLE_MOTION_DURATION } from "@private-voice/shared";

gsap.registerPlugin(CustomEase);
CustomEase.create("shanghao-out", "0.16,1,0.3,1");
CustomEase.create("shanghao-spatial", "0.22,1,0.36,1");
CustomEase.create("shanghao-in-out", "0.45,0,0.55,1");
CustomEase.create("shanghao-drawer", "0.2,0.82,0.22,1");
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

export const configureMotionRuntime = (): void => {
  // GSAP follows requestAnimationFrame, so 120/144 Hz displays stay uncapped.
  gsap.config({
    autoSleep: 60,
    force3D: true,
    nullTargetWarn: false,
  });
  gsap.ticker.lagSmoothing(500, 33);
};
