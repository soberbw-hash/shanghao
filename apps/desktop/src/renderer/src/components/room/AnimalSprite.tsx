import { type CSSProperties, useEffect, useState } from "react";

import type { BuiltInAvatarId, MemberActivity } from "@private-voice/shared";

import catMotion from "../../assets/avatars/motion/cat-motion.png";
import corgiMotion from "../../assets/avatars/motion/corgi-motion.png";
import duckMotion from "../../assets/avatars/motion/duck-motion.png";
import foxMotion from "../../assets/avatars/motion/fox-motion.png";
import pandaMotion from "../../assets/avatars/motion/panda-motion.png";
import { getAvatarSrc } from "../../utils/profile";

type AnimationState = "idle" | "walk" | "gaming" | "drinking" | "fitness" | "away" | "speaking";

const animationStates: AnimationState[] = [
  "idle",
  "walk",
  "gaming",
  "drinking",
  "fitness",
  "away",
  "speaking",
];

const motionSheets: Record<BuiltInAvatarId, string> = {
  fox: foxMotion,
  cat: catMotion,
  duck: duckMotion,
  panda: pandaMotion,
  corgi: corgiMotion,
};

const motionRows: Record<AnimationState, number> = {
  idle: 0,
  walk: 1,
  gaming: 2,
  drinking: 3,
  speaking: 4,
  fitness: 5,
  away: 6,
};

const motionDurations: Record<AnimationState, string> = {
  idle: "1.7s",
  walk: "0.62s",
  gaming: "0.9s",
  drinking: "1.45s",
  speaking: "0.72s",
  fitness: "0.68s",
  away: "1.9s",
};

const activityToAnimationState = (activity: MemberActivity): AnimationState => {
  switch (activity) {
    case "gaming": return "gaming";
    case "drinking": return "drinking";
    case "fitness": return "fitness";
    case "restroom": return "away";
    default: return "idle";
  }
};

interface AnimalSpriteProps {
  avatarId: BuiltInAvatarId;
  state?: AnimationState | MemberActivity;
  isMoving?: boolean;
  className?: string;
}

export const AnimalSprite = ({
  avatarId,
  state = "idle",
  isMoving = false,
  className = "",
}: AnimalSpriteProps) => {
  const [currentSrc, setCurrentSrc] = useState<string>("");
  const [hasError, setHasError] = useState(false);

  const resolvedState = typeof state === "string" && animationStates.includes(state as AnimationState)
    ? state as AnimationState
    : activityToAnimationState(state as MemberActivity);
  const animationState = isMoving ? "walk" : resolvedState;

  useEffect(() => {
    setHasError(false);
    setCurrentSrc(getAvatarSrc(avatarId) ?? "");
  }, [avatarId]);

  const sheetSrc = motionSheets[avatarId];
  const motionStyle = {
    backgroundImage: `url(${sheetSrc})`,
    "--motion-row": motionRows[animationState],
    "--motion-duration": motionDurations[animationState],
  } as CSSProperties & Record<string, string | number>;

  if (!hasError && sheetSrc) {
    return (
      <div
        aria-hidden="true"
        className={`animal-motion-sprite ${className}`}
        style={motionStyle}
      />
    );
  }

  if (!currentSrc) {
    return (
      <img
        src={getAvatarSrc(avatarId)}
        alt=""
        className={`animal-sprite-img ${className}`}
        draggable={false}
      />
    );
  }

  return (
    <img
      src={currentSrc}
      alt=""
      className={`animal-sprite-img animate-idle ${className}`}
      draggable={false}
      onError={() => setHasError(true)}
    />
  );
};
