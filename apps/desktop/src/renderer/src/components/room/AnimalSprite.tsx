import { useEffect, useState } from "react";

import type { BuiltInAvatarId, MemberActivity } from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";

type AnimationState = "idle" | "gaming" | "drinking" | "fitness" | "away" | "speaking";

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
  className?: string;
}

const animationClasses: Record<AnimationState, string> = {
  idle: "animate-idle",
  gaming: "animate-speaking",
  drinking: "animate-idle",
  fitness: "animate-speaking",
  away: "animate-away",
  speaking: "animate-speaking",
};

export const AnimalSprite = ({
  avatarId,
  state = "idle",
  className = "",
}: AnimalSpriteProps) => {
  const [currentSrc, setCurrentSrc] = useState<string>("");
  const [hasError, setHasError] = useState(false);

  const animationState = typeof state === "string" && ["idle", "gaming", "drinking", "fitness", "away", "speaking"].includes(state)
    ? state as AnimationState
    : activityToAnimationState(state as MemberActivity);

  useEffect(() => {
    setHasError(false);
    setCurrentSrc(getAvatarSrc(avatarId) ?? "");
  }, [avatarId]);

  const animClass = animationClasses[animationState] ?? animationClasses.idle;

  if (hasError || !currentSrc) {
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
      className={`animal-sprite-img ${animClass} ${className}`}
      draggable={false}
      onError={() => setHasError(true)}
    />
  );
};
