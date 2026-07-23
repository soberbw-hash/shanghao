import type { Variants } from "framer-motion";

import { APPLE_MOTION_EASE } from "@private-voice/shared";

const exitEase = [0.4, 0, 1, 1] as const;

export const reducedFadeVariants: Variants = {
  initial: { opacity: 0 },
  open: { opacity: 1, transition: { duration: 0.14, ease: APPLE_MOTION_EASE } },
  closed: { opacity: 0, transition: { duration: 0.12, ease: exitEase } },
};

export const overlayScrimVariants: Variants = {
  initial: { opacity: 0 },
  open: { opacity: 1, transition: { duration: 0.18, ease: APPLE_MOTION_EASE } },
  closed: { opacity: 0, transition: { duration: 0.15, ease: exitEase } },
};

export const dialogSurfaceVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.965 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 360, damping: 32, mass: 0.78 },
  },
  closed: {
    opacity: 0,
    y: 6,
    scale: 0.985,
    transition: { duration: 0.18, ease: exitEase },
  },
};

export const popoverSurfaceVariants: Variants = {
  initial: { opacity: 0, y: 6, scale: 0.97 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 440, damping: 34, mass: 0.68 },
  },
  closed: {
    opacity: 0,
    y: 3,
    scale: 0.985,
    transition: { duration: 0.14, ease: exitEase },
  },
};

export const toastItemVariants: Variants = {
  initial: { opacity: 0, y: -8, scale: 0.975 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 420, damping: 34, mass: 0.72 },
  },
  closed: {
    opacity: 0,
    y: -4,
    scale: 0.99,
    transition: { duration: 0.16, ease: exitEase },
  },
};
