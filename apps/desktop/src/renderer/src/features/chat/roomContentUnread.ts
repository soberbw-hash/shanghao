import type { ChatMessage } from "@private-voice/shared";

export type RoomContentTab = "chat" | "chronicle";
type ChronicleSnapshot = { sessionId: string; entries: readonly { id: string }[] };
export type RoomContentUnread = Record<RoomContentTab, boolean>;

/** Room-scoped cursors survive ACKs and reconnects, without storing message bodies. */
export class RoomContentReadCursor {
  private roomId?: string;
  private messageIds = new Set<string>();
  private chatWatermark = 0;
  private chronicleSignatures = new Set<string>();
  private sessions = new Set<string>();
  private unread: RoomContentUnread = { chat: false, chronicle: false };

  observe(
    roomId: string,
    messages: readonly ChatMessage[],
    chronicle: ChronicleSnapshot | undefined,
    active: RoomContentTab,
    now = Date.now(),
  ): RoomContentUnread {
    const reset = this.roomId !== roomId;
    if (reset) {
      this.roomId = roomId;
      this.messageIds.clear();
      this.chronicleSignatures.clear();
      this.sessions.clear();
      this.chatWatermark = now;
      this.unread = { chat: false, chronicle: false };
    }
    let newest = this.chatWatermark;
    for (const message of messages) {
      const id = message.clientMessageId ?? message.id;
      const at = Date.parse(message.createdAt);
      if (
        !reset &&
        !message.isLocal &&
        message.kind !== "system" &&
        !this.messageIds.has(id) &&
        at >= this.chatWatermark &&
        active !== "chat"
      )
        this.unread.chat = true;
      this.messageIds.add(id);
      // Optimistic local timestamps can be ahead of the signaling server clock.
      if (!message.isLocal && message.kind !== "system" && Number.isFinite(at))
        newest = Math.max(newest, at);
    }
    this.chatWatermark = newest;
    // Bound room-lifetime dedupe memory; older chat history remains below the watermark.
    this.messageIds = new Set([...this.messageIds].slice(-500));
    if (chronicle) {
      if (!reset && active !== "chronicle" && !this.sessions.has(chronicle.sessionId))
        this.unread.chronicle = true;
      this.sessions.add(chronicle.sessionId);
      for (const entry of chronicle.entries) {
        const signature = `${chronicle.sessionId}:${entry.id}`;
        if (!reset && active !== "chronicle" && !this.chronicleSignatures.has(signature))
          this.unread.chronicle = true;
        this.chronicleSignatures.add(signature);
      }
      this.sessions = new Set([...this.sessions].slice(-50));
      this.chronicleSignatures = new Set([...this.chronicleSignatures].slice(-500));
    }
    this.unread[active] = false;
    return { ...this.unread };
  }

  read(tab: RoomContentTab): RoomContentUnread {
    this.unread[tab] = false;
    return { ...this.unread };
  }
}
