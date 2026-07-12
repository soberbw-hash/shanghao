import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

import { APPLE_MOTION_DURATION } from "@private-voice/shared";

gsap.registerPlugin(CustomEase);
CustomEase.create("shanghao-out", "0.23,1,0.32,1");
CustomEase.create("shanghao-in-out", "0.77,0,0.175,1");
CustomEase.create("shanghao-drawer", "0.32,0.72,0,1");

export const motionEase = {
  spatial: "shanghao-out",
  standard: "shanghao-out",
  feedback: "shanghao-out",
  inOut: "shanghao-in-out",
  drawer: "shanghao-drawer",
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
