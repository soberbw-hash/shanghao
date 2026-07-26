import type { BuiltInAvatarId } from "@private-voice/shared";

import type { CharacterMotionRoute, CharacterRouteKind } from "./characterMotion";

export interface CharacterPersonality {
  walkSpeedMultiplier: number;
  runSpeedMultiplier: number;
  strideMultiplier: number;
  landingSpring: "soft" | "physical";
  turnPauseMs: number;
  idleWeights: {
    look: number;
    stretch: number;
    sip: number;
    type: number;
    phone: number;
  };
  arrivalAction: "glance-back" | "soft-settle" | "small-bounce" | "weighted-settle" | "ear-shake";
  greetingStyle: "quick" | "gentle" | "bouncy" | "calm" | "eager";
}

const CHARACTER_PERSONALITIES: Record<BuiltInAvatarId, CharacterPersonality> = {
  fox: {
    walkSpeedMultiplier: 1.06,
    runSpeedMultiplier: 1.1,
    strideMultiplier: 1.05,
    landingSpring: "soft",
    turnPauseMs: 75,
    idleWeights: { look: 4, stretch: 2, sip: 2, type: 3, phone: 1 },
    arrivalAction: "glance-back",
    greetingStyle: "quick",
  },
  cat: {
    walkSpeedMultiplier: 1,
    runSpeedMultiplier: 1.02,
    strideMultiplier: 0.98,
    landingSpring: "soft",
    turnPauseMs: 105,
    idleWeights: { look: 4, stretch: 3, sip: 2, type: 2, phone: 2 },
    arrivalAction: "soft-settle",
    greetingStyle: "gentle",
  },
  duck: {
    walkSpeedMultiplier: 0.94,
    runSpeedMultiplier: 0.98,
    strideMultiplier: 1.08,
    landingSpring: "soft",
    turnPauseMs: 145,
    idleWeights: { look: 3, stretch: 2, sip: 4, type: 2, phone: 1 },
    arrivalAction: "small-bounce",
    greetingStyle: "bouncy",
  },
  panda: {
    walkSpeedMultiplier: 0.88,
    runSpeedMultiplier: 0.92,
    strideMultiplier: 0.92,
    landingSpring: "physical",
    turnPauseMs: 155,
    idleWeights: { look: 3, stretch: 4, sip: 3, type: 1, phone: 2 },
    arrivalAction: "weighted-settle",
    greetingStyle: "calm",
  },
  corgi: {
    walkSpeedMultiplier: 1.1,
    runSpeedMultiplier: 1.15,
    strideMultiplier: 1.12,
    landingSpring: "soft",
    turnPauseMs: 70,
    idleWeights: { look: 3, stretch: 2, sip: 1, type: 3, phone: 2 },
    arrivalAction: "ear-shake",
    greetingStyle: "eager",
  },
};

export const getCharacterPersonality = (avatarId: BuiltInAvatarId): CharacterPersonality =>
  CHARACTER_PERSONALITIES[avatarId] ?? CHARACTER_PERSONALITIES.fox;

export const applyCharacterPersonality = (
  route: CharacterMotionRoute,
  kind: CharacterRouteKind,
  personality: CharacterPersonality,
): CharacterMotionRoute => {
  const speedMultiplier =
    kind === "enter" || kind === "exit"
      ? personality.runSpeedMultiplier
      : personality.walkSpeedMultiplier;
  return {
    ...route,
    duration: route.duration / speedMultiplier,
    strideDurationMs: Math.round(route.strideDurationMs / personality.strideMultiplier),
  };
};

export const weightedIdleActions = (
  personality: CharacterPersonality,
): Array<keyof CharacterPersonality["idleWeights"]> =>
  Object.entries(personality.idleWeights).flatMap(([action, weight]) =>
    Array.from({ length: weight }, () => action as keyof CharacterPersonality["idleWeights"]),
  );
