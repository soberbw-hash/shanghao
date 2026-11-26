import { useEffect, useRef } from "react";
import type { ChatMessage } from "@private-voice/shared";

export function useNoticeMessageFocus(
  messages: ChatMessage[],
  focusedMessage: { messageId?: string } | undefined,
  alternateContentActive: boolean,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const targetIndex = focusedMessage?.messageId
    ? messages.findIndex((message) => message.id === focusedMessage.messageId)
    : -1;
  const listStart = Math.max(
    0,
    targetIndex < 0 ? messages.length - 100 : Math.min(targetIndex, messages.length - 100),
  );
  const hasTarget = targetIndex >= 0;
  const lastFocusedMessage = useRef<typeof focusedMessage>(undefined);
  useEffect(() => {
    if (
      !hasTarget ||
      !focusedMessage?.messageId ||
      alternateContentActive ||
      lastFocusedMessage.current === focusedMessage
    )
      return;
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(focusedMessage.messageId)}"]`,
    );
    if (row?.isConnected) {
      row.scrollIntoView({ block: "center", behavior: "instant" });
      lastFocusedMessage.current = focusedMessage;
    }
  }, [focusedMessage, hasTarget, alternateContentActive, listRef]);
  return { listStart, listRef };
}
