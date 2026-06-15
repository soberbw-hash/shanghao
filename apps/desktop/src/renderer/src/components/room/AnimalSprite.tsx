import { useEffect, useRef, useState } from "react";

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

const getAnimationPath = (avatarId: BuiltInAvatarId, state: AnimationState): string[] => {
  const base = `/assets/animations/${avatarId}`;
  const stateFile = state === "away" ? "away" : state;
  return [
    `${base}/${stateFile}.webm`,
    `${base}/${stateFile}.webp`,
    `${base}/${stateFile}.png`,
  ];
};

export const AnimalSprite = ({
  avatarId,
  state = "idle",
  className = "",
}: AnimalSpriteProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaType, setMediaType] = useState<"video" | "image">("image");
  const [currentSrc, setCurrentSrc] = useState<string>("");
  const [hasError, setHasError] = useState(false);

  const animationState = typeof state === "string" && ["idle", "gaming", "drinking", "fitness", "away", "speaking"].includes(state)
    ? state as AnimationState
    : activityToAnimationState(state as MemberActivity);

  useEffect(() => {
    setHasError(false);
    const sources = getAnimationPath(avatarId, animationState);

    const tryLoad = async (): Promise<void> => {
      for (const src of sources) {
        try {
          const response = await fetch(src, { method: "HEAD" });
          if (response.ok) {
            if (src.endsWith(".webm")) {
              setMediaType("video");
            } else {
              setMediaType("image");
            }
            setCurrentSrc(src);
            return;
          }
        } catch {
          continue;
        }
      }
      setMediaType("image");
      setCurrentSrc(getAvatarSrc(avatarId) ?? "");
    };

    void tryLoad();
  }, [avatarId, animationState]);

  useEffect(() => {
    if (mediaType === "video" && videoRef.current) {
      void videoRef.current.play().catch(() => undefined);
    }
  }, [mediaType, currentSrc]);

  if (hasError || !currentSrc) {
    return (
      <img
        src={getAvatarSrc(avatarId)}
        alt=""
        className={`h-[96px] w-[96px] object-contain ${className}`}
        draggable={false}
      />
    );
  }

  if (mediaType === "video") {
    return (
      <video
        ref={videoRef}
        src={currentSrc}
        className={`h-[96px] w-[96px] object-contain ${className}`}
        muted
        autoPlay
        loop
        playsInline
        onError={() => setHasError(true)}
      />
    );
  }

  return (
    <img
      src={currentSrc}
      alt=""
      className={`h-[96px] w-[96px] object-contain ${className}`}
      draggable={false}
      onError={() => setHasError(true)}
    />
  );
};
