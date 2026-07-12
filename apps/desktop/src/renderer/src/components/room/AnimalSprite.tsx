import { type CSSProperties, useEffect, useState } from "react";

import type { BuiltInAvatarId, MemberActivity } from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";

type AnimationState = "idle" | "walk" | "gaming" | "drinking" | "fitness" | "away" | "speaking";
type LayerPart = "tail" | "body" | "feet" | "head";

const animationStates: AnimationState[] = [
  "idle",
  "walk",
  "gaming",
  "drinking",
  "fitness",
  "away",
  "speaking",
];

const layerParts: LayerPart[] = ["tail", "body", "feet", "head"];
const avatarLayerAssets = import.meta.glob("../../assets/avatars/layers/*.png", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const layerSrc = (avatarId: BuiltInAvatarId, part: LayerPart): string | undefined =>
  avatarLayerAssets[`../../assets/avatars/layers/${avatarId}-${part}.png`];

const activityToAnimationState = (activity: MemberActivity): AnimationState => {
  switch (activity) {
    case "gaming":
      return "gaming";
    case "drinking":
      return "drinking";
    case "fitness":
      return "fitness";
    case "restroom":
      return "away";
    default:
      return "idle";
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

  const resolvedState =
    typeof state === "string" && animationStates.includes(state as AnimationState)
      ? (state as AnimationState)
      : activityToAnimationState(state as MemberActivity);
  const animationState = isMoving ? "walk" : resolvedState;

  useEffect(() => {
    setHasError(false);
    setCurrentSrc(getAvatarSrc(avatarId) ?? "");
  }, [avatarId]);

  const layers = layerParts
    .map((part) => ({ part, src: layerSrc(avatarId, part) }))
    .filter((layer): layer is { part: LayerPart; src: string } => Boolean(layer.src));

  if (!hasError && layers.length === layerParts.length) {
    return (
      <div
        aria-hidden="true"
        className={`layered-animal layered-animal-${animationState} ${isMoving ? "is-moving" : ""} ${className}`}
        style={
          { "--layer-count": layers.length } as CSSProperties & Record<string, string | number>
        }
      >
        <span className="layered-animal-shadow" />
        {layers.map(({ part, src }) => (
          <img
            key={part}
            src={src}
            alt=""
            className={`layered-animal-part layered-animal-${part}`}
            draggable={false}
            onError={() => setHasError(true)}
          />
        ))}
      </div>
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
