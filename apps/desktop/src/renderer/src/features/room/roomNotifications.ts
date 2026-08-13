import type { ChatMessage } from "@private-voice/shared";

import { playUiSound } from "../audio/uiSound";

const SCENE_REACTION_SOUND_COOLDOWN_MS = 320;
let lastSceneReactionSoundAt = 0;

export const describeChatNotification = (message: ChatMessage): string => {
  const content = message.content.replace(/\s+/g, " ").trim();
  if (content && message.image) return `${content.slice(0, 145)} · 图片`;
  if (content) return content.slice(0, 160);
  if (message.image) return "发来了一张图片";
  return "发来了一条消息";
};

export const sendSystemNotification = (payload: {
  title: string;
  body: string;
  attention?: boolean;
  shakeWindow?: boolean;
  showNotification?: boolean;
}): void => {
  const notify = window.desktopApi?.app?.notify;
  if (typeof notify === "function") void notify(payload);
};

export const playSceneReactionSound = (sound: "receive-message" | "send-message"): void => {
  const now = Date.now();
  if (now - lastSceneReactionSoundAt < SCENE_REACTION_SOUND_COOLDOWN_MS) return;
  lastSceneReactionSoundAt = now;
  playUiSound(sound);
};
