import { createContext, useContext } from "react";
import type { BuiltInAvatarId, WeatherDayPhase, WeatherSceneKind } from "@private-voice/shared";
import { DynamicWeatherWindow } from "../../apps/desktop/src/renderer/src/components/room/DynamicWeatherWindow";
import {
  DeskAnimalSprite,
  WalkingAnimalSprite,
} from "../../apps/desktop/src/renderer/src/components/room/DeskAnimalSprite";
import { getAvatarSrc } from "../../apps/desktop/src/renderer/src/utils/profile";
import { usePrefersReducedMotion } from "../../apps/desktop/src/renderer/src/hooks/usePrefersReducedMotion";
import { useVisualVisibility } from "../../apps/desktop/src/renderer/src/hooks/useVisualVisibility";
import type { CharacterIdleAction } from "../../apps/desktop/src/renderer/src/features/voice-scene/characterPersonality";

export const weatherScenes: Array<[WeatherSceneKind, string]> = [
  ["clear", "晴朗"],
  ["partly_cloudy", "多云"],
  ["overcast", "阴天"],
  ["light_rain", "小雨"],
  ["heavy_rain", "大雨"],
  ["thunderstorm", "雷雨"],
  ["snow", "下雪"],
  ["fog", "雾"],
];
export const characterKinds: Array<[BuiltInAvatarId, string]> = [
  ["cat", "小猫"],
  ["corgi", "柯基"],
  ["duck", "小鸭"],
  ["fox", "狐狸"],
  ["panda", "熊猫"],
];
export const characterActions = [
  ["front", "正面"],
  ["idle", "坐着待机"],
  ["walk-left", "向左走"],
  ["walk-right", "向右走"],
  ["gaming", "打游戏"],
  ["speaking", "说话"],
  ["muted", "静音"],
  ["welcoming", "欢迎朋友"],
  ["screen-sharing", "分享屏幕"],
  ["blink", "眨眼"],
  ["ear", "动耳朵"],
  ["look", "左右看"],
  ["stretch", "伸懒腰"],
  ["yawn", "打哈欠"],
  ["sip", "喝一口"],
  ["type", "敲键盘"],
  ["phone", "接电话"],
] as const;
export const MotionPreviewContext = createContext<{
  phase: WeatherDayPhase;
  action: string;
  paused: boolean;
}>({
  phase: "day",
  action: "idle",
  paused: false,
});
export function WeatherPreview({ scene }: { scene: WeatherSceneKind }) {
  const { phase, paused } = useContext(MotionPreviewContext);
  return (
    <div className={`review-window ${paused ? "review-motion-paused" : ""}`}>
      <DynamicWeatherWindow isEnabled previewOverride={{ scene, phase }} />
    </div>
  );
}
export function CharacterPreview({
  avatarId,
  actionOverride,
}: {
  avatarId: BuiltInAvatarId;
  actionOverride?: string;
}) {
  const { action: selectedAction, paused } = useContext(MotionPreviewContext);
  const action = actionOverride ?? selectedAction;
  const visible = useVisualVisibility();
  const reduced = usePrefersReducedMotion();
  const stopped = paused || !visible || reduced;
  const walk = action.startsWith("walk-");
  const idleAction = ["blink", "ear", "look", "stretch", "yawn", "sip", "type", "phone"].includes(
    action,
  )
    ? (action as CharacterIdleAction)
    : "none";
  return (
    <div
      className={`review-character-stage ${stopped ? "review-motion-paused" : ""}`}
      data-preview-avatar={avatarId}
      data-preview-action={action}
    >
      <span
        className={`review-character-actor ${walk ? (action === "walk-left" ? "review-walk-left" : "review-walk-right") : ""}`}
      >
        {action === "front" ? (
          <img className="review-character-front" src={getAvatarSrc(avatarId)} alt="" />
        ) : walk ? (
          <WalkingAnimalSprite
            avatarId={avatarId}
            direction={action === "walk-left" ? "left" : "right"}
            paused={stopped}
          />
        ) : (
          <DeskAnimalSprite
            avatarId={avatarId}
            activity={action === "gaming" ? "gaming" : "idle"}
            isSpeaking={action === "speaking"}
            isMoving={false}
            isMuted={action === "muted"}
            isScreenSharing={action === "screen-sharing"}
            isWelcoming={action === "welcoming"}
            idleAction={idleAction}
          />
        )}
      </span>
    </div>
  );
}
