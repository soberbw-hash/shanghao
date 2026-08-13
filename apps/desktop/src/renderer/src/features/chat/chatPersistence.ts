import type { ChatMessage } from "@private-voice/shared";

import { useRoomStore } from "../../store/roomStore";
import { writeRendererLog } from "../../utils/logger";

export type ChannelId = "main" | "side";

let writeQueue: Promise<void> = Promise.resolve();

export const createPersistableChatHistory = (messages: ChatMessage[]): ChatMessage[] => {
  const persisted: ChatMessage[] = [];
  let serializedLength = 2;
  for (let index = messages.length - 1; index >= 0 && persisted.length < 500; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const nextLength = JSON.stringify(message).length + (persisted.length > 0 ? 1 : 0);
    if (serializedLength + nextLength > 24 * 1024 * 1024) break;
    serializedLength += nextLength;
    persisted.unshift(message);
  }
  return persisted;
};

export const persistChatHistory = (serverUrl: string, channelId: ChannelId): void => {
  const saveChatHistory = window.desktopApi?.app?.saveChatHistory;
  if (typeof saveChatHistory !== "function") return;
  const messages = createPersistableChatHistory(useRoomStore.getState().chatMessages);
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(() => saveChatHistory({ serverUrl, channelId, messages }))
    .catch((error) => {
      void writeRendererLog("app", "warn", "Failed to persist local chat history", {
        channelId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};
