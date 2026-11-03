import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@private-voice/shared";
import { MessageCircle, NotebookPen } from "lucide-react";
import { RoomContentReadCursor, type RoomContentTab } from "../../features/chat/roomContentUnread";
import { useRoomStore } from "../../store/roomStore";

export function RoomContentTabs({
  roomId,
  messages,
  tab,
  onSelect,
  idPrefix,
}: {
  roomId: string;
  messages: ChatMessage[];
  tab: RoomContentTab;
  onSelect: (tab: RoomContentTab) => void;
  idPrefix: string;
}) {
  const chronicle = useRoomStore((state) => state.chronicle?.state);
  const cursor = useRef(new RoomContentReadCursor());
  const [unread, setUnread] = useState({ chat: false, chronicle: false });
  useEffect(() => {
    setUnread(cursor.current.observe(roomId, messages, chronicle, tab));
  }, [roomId, messages, chronicle, tab]);
  const select = (next: RoomContentTab) => {
    setUnread(cursor.current.read(next));
    onSelect(next);
  };
  return (
    <span className="chat-content-tabs" role="tablist" aria-label="房间内容">
      {(["chat", "chronicle"] as const).map((key) => (
        <button
          key={key}
          id={`${idPrefix}-tab-${key}`}
          type="button"
          role="tab"
          aria-controls={`${idPrefix}-panel-${key}`}
          aria-selected={tab === key}
          aria-label={`${key === "chat" ? "聊天" : "转录"}${unread[key] ? "，有新内容" : ""}`}
          tabIndex={tab === key ? 0 : -1}
          onClick={() => select(key)}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "chat"
                : event.key === "End"
                  ? "chronicle"
                  : key === "chat"
                    ? "chronicle"
                    : "chat";
            select(next);
            document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
          }}
        >
          {key === "chat" ? (
            <MessageCircle size={13} aria-hidden="true" />
          ) : (
            <NotebookPen size={13} aria-hidden="true" />
          )}
          {key === "chat" ? "聊天" : "转录"}
          {unread[key] ? <span className="chat-content-unread" aria-hidden="true" /> : null}
        </button>
      ))}
    </span>
  );
}
