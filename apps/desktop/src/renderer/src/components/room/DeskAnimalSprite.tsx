import type { CSSProperties } from "react";

import type { BuiltInAvatarId, MemberActivity } from "@private-voice/shared";

import chairArt from "../../assets/scenes/chair-chibi.webp";
import catRear from "../../assets/avatars/rear-v2/cat-rear.png";
import corgiRear from "../../assets/avatars/rear-v2/corgi-rear.png";
import duckRear from "../../assets/avatars/rear-v2/duck-rear.png";
import foxRear from "../../assets/avatars/rear-v2/fox-rear.png";
import pandaRear from "../../assets/avatars/rear-v2/panda-rear.png";
import catRunCycle from "../../assets/avatars/run-cycles-v2/cat.png";
import corgiRunCycle from "../../assets/avatars/run-cycles-v2/corgi.png";
import duckRunCycle from "../../assets/avatars/run-cycles-v2/duck.png";
import foxRunCycle from "../../assets/avatars/run-cycles-v2/fox.png";
import pandaRunCycle from "../../assets/avatars/run-cycles-v2/panda.png";

export type DeskAnimalIdleAction = "none" | "look" | "stretch" | "sip" | "type" | "phone";

const rearAvatarSources: Record<BuiltInAvatarId, string> = {
  cat: catRear,
  corgi: corgiRear,
  duck: duckRear,
  fox: foxRear,
  panda: pandaRear,
};

const runCycleSources: Record<BuiltInAvatarId, string> = {
  cat: catRunCycle,
  corgi: corgiRunCycle,
  duck: duckRunCycle,
  fox: foxRunCycle,
  panda: pandaRunCycle,
};

const characterSpriteSources = [
  ...Object.values(runCycleSources),
  ...Object.values(rearAvatarSources),
];
let characterSpritePreload: Promise<void> | undefined;

export const preloadCharacterSpriteAssets = (): Promise<void> => {
  characterSpritePreload ??= (async () => {
    // Decode sequentially while the home screen is idle so joining a room does not
    // make all five large sprite sheets compete for memory on the first frame.
    for (const source of characterSpriteSources) {
      const image = new Image();
      image.decoding = "async";
      image.src = source;
      try {
        await image.decode();
      } catch {
        // Chromium can still render the image after a transient decode rejection.
      }
    }
  })();

  return characterSpritePreload;
};

export const WalkingAnimalSprite = ({
  avatarId,
  direction = "right",
  strideDurationMs = 520,
  paused = false,
}: {
  avatarId: BuiltInAvatarId;
  direction?: "left" | "right";
  strideDurationMs?: number;
  paused?: boolean;
}) => {
  const runCycleSource = runCycleSources[avatarId] ?? runCycleSources.fox;

  return (
    <div
      className={`walking-animal walking-animal-${direction} ${paused ? "is-paused" : ""}`}
      data-run-cycle-avatar={avatarId}
      data-run-cycle-frames="8"
      style={{ "--run-cycle-duration": `${strideDurationMs}ms` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="walking-animal-shadow" />
      <span className="walking-animal-facing">
        <span className="walking-animal-run-cycle">
          <img
            className="walking-animal-run-cycle-strip"
            src={runCycleSource}
            alt=""
            draggable={false}
          />
        </span>
      </span>
    </div>
  );
};

export const DeskAnimalSprite = ({
  avatarId,
  activity,
  isSpeaking,
  isMoving,
  isMuted,
  isScreenSharing = false,
  isWelcoming = false,
  idleAction = "none",
}: {
  avatarId: BuiltInAvatarId;
  activity: MemberActivity;
  isSpeaking: boolean;
  isMoving: boolean;
  isMuted: boolean;
  isScreenSharing?: boolean;
  isWelcoming?: boolean;
  idleAction?: DeskAnimalIdleAction;
}) => {
  const source = rearAvatarSources[avatarId] ?? rearAvatarSources.fox;
  const motionState = isMoving
    ? "moving"
    : isMuted
      ? "muted"
      : isSpeaking
        ? "speaking"
        : activity === "gaming"
          ? "gaming"
          : "idle";

  return (
    <div
      className={`desk-animal desk-animal-${motionState} desk-animal-action-${idleAction} ${
        isScreenSharing ? "desk-animal-screen-sharing" : ""
      } ${isWelcoming ? "desk-animal-welcoming" : ""}`}
      aria-hidden="true"
    >
      <span className="desk-animal-ground-shadow" />
      <img
        className="desk-animal-chair desk-animal-chair-back"
        src={chairArt}
        alt=""
        draggable={false}
      />
      <img className="desk-animal-layer desk-animal-body" src={source} alt="" draggable={false} />
      <img className="desk-animal-layer desk-animal-head" src={source} alt="" draggable={false} />
      <img className="desk-animal-layer desk-animal-arm" src={source} alt="" draggable={false} />
    </div>
  );
};
