import type { Variants } from "framer-motion";

import { motionCurve, motionDuration, motionSpring } from "./motionSystem";

const exitEase = [0.4, 0, 1, 1] as const;

export const reducedFadeVariants: Variants = {
  initial: { opacity: 0 },
  open: {
    opacity: 1,
    transition: { duration: motionDuration.fast, ease: motionCurve.enter },
  },
  closed: {
    opacity: 0,
    transition: { duration: motionDuration.instant, ease: exitEase },
  },
};

export const overlayScrimVariants: Variants = {
  initial: { opacity: 0 },
  open: {
    opacity: 1,
    transition: { duration: motionDuration.compact, ease: motionCurve.enter },
  },
  closed: {
    opacity: 0,
    transition: { duration: motionDuration.fast, ease: exitEase },
  },
};

export const dialogSurfaceVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.965 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", ...motionSpring.soft },
  },
  closed: {
    opacity: 0,
    y: 6,
    scale: 0.985,
    transition: { duration: motionDuration.compact, ease: exitEase },
  },
};

export const popoverSurfaceVariants: Variants = {
  initial: { opacity: 0, y: 6, scale: 0.97 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", ...motionSpring.compact },
  },
  closed: {
    opacity: 0,
    y: 3,
    scale: 0.985,
    transition: { duration: motionDuration.fast, ease: exitEase },
  },
};

export const toastItemVariants: Variants = {
  initial: { opacity: 0, y: -8, scale: 0.975 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", ...motionSpring.compact },
  },
  closed: {
    opacity: 0,
    y: -4,
    scale: 0.99,
    transition: { duration: motionDuration.fast, ease: exitEase },
  },
};
