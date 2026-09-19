import { memo, useState } from "react";

import type { ChatImageAttachment, ChatMessage } from "@private-voice/shared";

import { playUiSound } from "../../features/audio/uiSound";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { prepareChatImage } from "../../utils/chatImage";
import { TemporaryChatPanel } from "./TemporaryChatPanel";

interface RoomChatPanelProps {
  sendChatMessage: (
    content: string,
    image?: ChatImageAttachment,
    existingClientMessageId?: string,
  ) => Promise<void>;
  recallChatMessage: (messageId: string) => Promise<void>;
  sendQuickMessage: (message: string) => Promise<void>;
  sendConfiguredQuickMessage: (presetId: string) => Promise<void>;
  onOpenQuickMessageSettings: () => void;
  onOpenRoomAi: () => void;
  canSend: boolean;
  reduceMotion: boolean;
}

/** Keeps chat traffic and composer state out of the room scene render domain. */
export const RoomChatPanel = memo(
  ({
    sendChatMessage,
    recallChatMessage,
    sendQuickMessage,
    sendConfiguredQuickMessage,
    onOpenQuickMessageSettings,
    onOpenRoomAi,
    canSend,
    reduceMotion,
  }: RoomChatPanelProps) => {
    const messages = useRoomStore((state) => state.chatMessages);
    const pushToast = useAppStore((state) => state.pushToast);
    const [chatInput, setChatInput] = useState("");

    const send = async () => {
      const content = chatInput.trim();
      if (!content) return;
      setChatInput("");
      try {
        await sendChatMessage(content);
        playUiSound("send-message");
      } catch {
        // The room transport keeps the failed optimistic message available for retry.
      }
    };

    const sendImage = async (file: File) => {
      if (!canSend) return;
      try {
        const image = await prepareChatImage(file);
        await sendChatMessage("", image);
        playUiSound("send-message");
      } catch {
        pushToast({
          tone: "warning",
          title: "图片没有发出去",
          description: "请确认图片是 PNG、JPG 或 WebP 且不超过 8 MB，然后重试。",
        });
      }
    };

    return (
      <TemporaryChatPanel
        className="h-full"
        messages={messages}
        chatInput={chatInput}
        onChatInputChange={setChatInput}
        onSend={() => void send()}
        onQuickSend={(message) => {
          void sendQuickMessage(message).catch(() => {
            pushToast({
              tone: "warning",
              title: "提醒没有发出去",
              description: "连接恢复后再试一次。",
            });
          });
        }}
        onQuickMessageSend={(presetId) => {
          void sendConfiguredQuickMessage(presetId).catch(() => {
            pushToast({
              tone: "warning",
              title: "快捷消息没有发出去",
              description: "连接恢复后再试一次。",
            });
          });
        }}
        onOpenQuickMessageSettings={onOpenQuickMessageSettings}
        onOpenRoomAi={onOpenRoomAi}
        onSendImage={sendImage}
        onRecall={async (messageId) => {
          try {
            await recallChatMessage(messageId);
          } catch {
            pushToast({
              tone: "danger",
              title: "撤回失败",
              description: "连接恢复后再试一次。",
            });
          }
        }}
        onRetry={async (message: ChatMessage) => {
          if (!message.clientMessageId) return;
          await sendChatMessage(message.content, message.image, message.clientMessageId);
        }}
        canSend={canSend}
        unavailableLabel="正在重连..."
        reduceMotion={reduceMotion}
      />
    );
  },
);

RoomChatPanel.displayName = "RoomChatPanel";
