import { isPrivateRoomId, type ChatMessage, type DesktopApi } from "@private-voice/shared";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";

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

export const openNotifiedRoom = (roomId: string, chat: boolean, messageId?: string): void => {
  const app = useAppStore.getState();
  const inRoom =
    app.currentPage === "room" ||
    (app.currentPage === "settings" && app.settingsReturnTo === "room");
  const sameRoom = inRoom && useRoomStore.getState().room.roomId === roomId;
  if (chat && (sameRoom || isPrivateRoomId(roomId))) {
    useAppStore.setState({ chatNoticeTarget: { roomId, messageId } });
  }
  if (sameRoom) {
    app.navigate("room");
  } else if (isPrivateRoomId(roomId)) {
    app.setPendingRoomInvite(roomId, true);
    app.navigate(inRoom ? "room" : "home");
  } else {
    app.pushToast({ title: "这次房间会话已结束", tone: "neutral" });
  }
};

export const sendSystemNotification = (
  payload: Parameters<DesktopApi["app"]["notify"]>[0],
): void => {
  const notify = window.desktopApi?.app?.notify;
  const room = payload.room;
  if (
    room &&
    room.kind !== "knock" &&
    document.hasFocus() &&
    document.visibilityState === "visible"
  ) {
    const app = useAppStore.getState();
    const readingChat =
      app.currentPage === "room" &&
      document.querySelector('[role="tabpanel"][aria-hidden="false"] .chat-message-list');
    if (!readingChat) {
      const chat = room.kind === "chat";
      app.pushToast({
        title: payload.title,
        description: payload.body,
        chatPreview: chat ? { image: room.imageDataUrl, link: room.link } : undefined,
        actionLabel: chat ? "查看消息" : "进入房间",
        onAction: () => openNotifiedRoom(room.id, chat, room.messageId),
      });
    }
    return;
  }
  if (typeof notify === "function") void notify(payload).catch(() => undefined);
};

export const playSceneReactionSound = (sound: "receive-message" | "send-message"): void => {
  const now = Date.now();
  if (now - lastSceneReactionSoundAt < SCENE_REACTION_SOUND_COOLDOWN_MS) return;
  lastSceneReactionSoundAt = now;
  playUiSound(sound);
};
