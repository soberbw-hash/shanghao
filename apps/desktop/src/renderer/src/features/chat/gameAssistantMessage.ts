import type { ChatMessage } from "@private-voice/shared";

// The existing relay echoes and persists clientMessageId, including on old servers.
// Presentation is independent of the authenticated author used for ACKs and recall.
export const gameAssistantMessageId = (uuid: string): string => `game-assistant:${uuid}`;
export const isGameAssistantMessage = (message: Pick<ChatMessage, "clientMessageId">): boolean =>
  /^game-assistant:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
    message.clientMessageId ?? "",
  );
export const chatDisplayName = (message: ChatMessage): string =>
  isGameAssistantMessage(message) ? "游戏助手" : message.nickname;
