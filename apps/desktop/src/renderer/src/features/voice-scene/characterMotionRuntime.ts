import type { CharacterMotionRoute } from "./characterMotion";

export type CharacterMotionPhase =
  | "entering"
  | "standing-up"
  | "walking"
  | "approaching"
  | "turning"
  | "sitting"
  | "idle"
  | "away-idle"
  | "leaving";

const sceneXFor = (left: number): string => `${left}cqw`;
const sceneYFor = (top: number): string => `${top}cqh`;

const CHARACTER_START_EASE = [0.35, 0, 0.65, 0.65] as const;
const CHARACTER_STOP_EASE = [0.35, 0.35, 0.65, 1] as const;
const CHARACTER_SHORT_EASE = [0.45, 0, 0.55, 1] as const;

const routeEasesFor = (pointCount: number, preserveVelocity = false) => {
  const segmentCount = Math.max(1, pointCount - 1);
  if (segmentCount === 1) {
    return [preserveVelocity ? CHARACTER_STOP_EASE : CHARACTER_SHORT_EASE];
  }
  return Array.from({ length: segmentCount }, (_, index) => {
    if (index === 0) return preserveVelocity ? ("linear" as const) : CHARACTER_START_EASE;
    if (index === segmentCount - 1) return CHARACTER_STOP_EASE;
    return "linear" as const;
  });
};

export const routeAnimation = (route: CharacterMotionRoute, preserveVelocity = false) => ({
  x: route.points.map((point) => sceneXFor(point.left)),
  y: route.points.map((point) => sceneYFor(point.top)),
  transition: {
    duration: route.duration,
    times: route.times,
    ease: routeEasesFor(route.points.length, preserveVelocity),
  },
});

export const scenePosition = (left: number, top: number) => ({
  x: sceneXFor(left),
  y: sceneYFor(top),
});

export const readSceneUnit = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const waitForMotionPhase = (durationMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, durationMs));
