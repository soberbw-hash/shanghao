import { useMemo } from "react";

import { useRoomStore } from "../../store/roomStore";
import { selectCharacterChatBubbles } from "./roomViewModel";

/** A system message or network sample must not re-render the illustrated room. */
export const useCharacterChatBubbles = () => {
  const chatVersion = useRoomStore((state) =>
    state.chatMessages
      .slice(-100)
      .filter(
        (message) =>
          message.kind !== "system" &&
          message.deliveryState !== "failed" &&
          Boolean(message.content.trim()),
      )
      .map((message) => `${message.id}:${message.deliveryState ?? "sent"}`)
      .join("|"),
  );
  const quickVersion = useRoomStore((state) =>
    state.quickMessages.map((message) => message.id).join("|"),
  );

  return useMemo(() => {
    if (!chatVersion && !quickVersion) return [];
    const { chatMessages, quickMessages } = useRoomStore.getState();
    return selectCharacterChatBubbles(chatMessages, quickMessages);
  }, [chatVersion, quickVersion]);
};
