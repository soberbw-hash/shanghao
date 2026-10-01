import { useLayoutEffect, useRef, type RefObject } from "react";
import type { BuiltInAvatarId } from "@private-voice/shared";
import { visualRuntimeController } from "../visual-runtime/VisualRuntimeController";

export const RUN_CYCLE_FRAME_COUNT = 16;

// Alpha > 160 top bounds measured from the unchanged 256px source poses.
// Stabilize most of the head displacement, retaining a small natural stride.
const headTops: Record<BuiltInAvatarId, readonly number[]> = {
  fox: [10, 15, 20, 21, 21, 17, 12, 20, 28, 22, 15, 21, 27, 20, 13, 12],
  cat: [11, 13, 14, 15, 16, 17, 19, 19, 19, 18, 17, 16, 16, 16, 17, 14],
  corgi: [18, 14, 11, 14, 17, 22, 28, 23, 19, 22, 26, 26, 25, 23, 21, 19],
  duck: [12, 11, 10, 10, 10, 18, 25, 21, 17, 19, 20, 22, 24, 19, 14, 13],
  panda: [10, 10, 10, 16, 21, 22, 23, 22, 20, 20, 20, 20, 20, 22, 24, 18],
};

const poseTransform = (avatarId: BuiltInAvatarId, frame: number): string => {
  const tops = headTops[avatarId] ?? headTops.fox;
  const sorted = [...tops].sort((a, b) => a - b);
  const center = (sorted[7]! + sorted[8]!) / 2;
  const y = ((center - tops[frame]!) * 0.75 * 100) / 256;
  return `translate3d(${-frame * 6.25}%, ${y.toFixed(3)}%, 0)`;
};

// Alternate even/odd poses; each strip jumps ONLY when its opacity is zero.
// The two opacity curves interpolate on the compositor at the display rate.
const stripFrames = (avatarId: BuiltInAvatarId, layer: number): Keyframe[] => {
  const frames: Keyframe[] = [
    { transform: poseTransform(avatarId, layer), offset: 0, easing: "steps(1, end)" },
  ];
  for (let frame = 2 + layer; frame < RUN_CYCLE_FRAME_COUNT; frame += 2) {
    frames.push({
      transform: poseTransform(avatarId, frame),
      offset: (frame - 1) / RUN_CYCLE_FRAME_COUNT,
      easing: "steps(1, end)",
    });
  }
  if (layer === 0) frames.push({ transform: poseTransform(avatarId, 0), offset: 15 / 16 });
  frames.push({ transform: poseTransform(avatarId, layer), offset: 1 });
  return frames;
};

export const useWalkingCycleMotion = (
  root: RefObject<HTMLSpanElement | null>,
  avatarId: BuiltInAvatarId,
  enabled: boolean,
  durationMs: number,
): void => {
  const previousPhase = useRef<{ avatarId: BuiltInAvatarId; value: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const layers = root.current?.querySelectorAll<HTMLElement>(".walking-animal-pose");
    if (!enabled || !layers || layers.length !== 2) return;
    const animations: Animation[] = [];
    const timing = { duration: durationMs, iterations: Infinity, easing: "linear" };
    try {
      layers.forEach((layer, index) => {
        const strip = layer.querySelector<HTMLImageElement>("img");
        if (!strip) return;
        animations.push(strip.animate(stripFrames(avatarId, index), timing));
        animations.push(
          layer.animate(
            Array.from({ length: 17 }, (_, frame) => ({
              opacity: (frame + index) % 2 === 0 ? 1 : 0,
              offset: frame / 16,
            })),
            timing,
          ),
        );
      });
      // Use one timeline origin so texture changes and blending cannot drift.
      const startTime = document.timeline.currentTime;
      const phase = previousPhase.current?.avatarId === avatarId ? previousPhase.current.value : 0;
      if (typeof startTime === "number")
        animations.forEach((animation) => {
          animation.startTime = startTime - phase * durationMs;
        });
    } catch {
      animations.forEach((animation) => animation.cancel());
      return; // CSS keeps the first decoded pose visible on unsupported engines.
    }
    const unsubscribe = visualRuntimeController.subscribeVisibility((visible) => {
      animations.forEach((animation) => (visible ? animation.play() : animation.pause()));
    });
    return () => {
      unsubscribe();
      const currentTime = animations[0]?.currentTime;
      if (typeof currentTime === "number")
        previousPhase.current = { avatarId, value: (currentTime % durationMs) / durationMs };
      animations.forEach((animation) => animation.cancel());
    };
  }, [root, avatarId, enabled, durationMs]);
};
