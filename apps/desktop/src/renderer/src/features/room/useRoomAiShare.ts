import { useRef, useState } from "react";
import { RoomConnectionState } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { playUiSound } from "../audio/uiSound";

/** Share through the existing ACK/retry path, retaining IDs after a partial failure. */
export const useRoomAiShare = (
  onSend: (content: string, clientMessageId: string) => Promise<void>,
) => {
  const delivery = useRef<
    { roomId: string; text: string; chunks: string[]; ids: string[]; sent: number } | undefined
  >(undefined);
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const share = async (text: string) => {
    if (busy.current || !text.trim()) return;
    const initialRoom = useRoomStore.getState().room;
    if (text.length > 16_000) {
      setNotice("答案过长，请复制需要的部分到聊天。");
      return;
    }
    if (delivery.current?.text !== text || delivery.current.roomId !== initialRoom.roomId) {
      // Match the current server's 500 UTF-16 character limit without cutting surrogate pairs.
      const chunks: string[] = [];
      let chunk = "";
      for (const character of text.trim()) {
        if (chunk.length + character.length > 500) {
          chunks.push(chunk);
          chunk = "";
        }
        chunk += character;
      }
      if (chunk) chunks.push(chunk);
      delivery.current = {
        roomId: initialRoom.roomId,
        text,
        chunks,
        ids: chunks.map(() => crypto.randomUUID()),
        sent: 0,
      };
    }
    const batch = delivery.current;
    if (batch.sent === batch.chunks.length) {
      setNotice("这段答案已发送到聊天。");
      return;
    }
    busy.current = true;
    setSending(true);
    setNotice("");
    try {
      while (batch.sent < batch.chunks.length) {
        const room = useRoomStore.getState().room;
        if (room.roomId !== batch.roomId) throw new Error("room_changed");
        if (
          ![
            RoomConnectionState.Connected,
            RoomConnectionState.WaitingPeer,
            RoomConnectionState.WaitingSnapshot,
          ].includes(room.connectionState)
        )
          throw new Error("connection_unavailable");
        await onSend(batch.chunks[batch.sent]!, batch.ids[batch.sent]!);
        batch.sent += 1;
      }
      playUiSound("send-message");
      setNotice("已发送到聊天。");
    } catch {
      setNotice(
        batch.sent
          ? `已发送 ${batch.sent}/${batch.chunks.length} 段，连接恢复后点击继续发送。`
          : "发送失败，连接恢复后可重试。",
      );
    } finally {
      busy.current = false;
      setSending(false);
    }
  };
  return { share, sending, notice, clearNotice: () => setNotice("") };
};
