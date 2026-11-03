import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoomConnectionState } from "@private-voice/shared";
import { RoomChatPanel } from "../../src/renderer/src/components/chat/RoomChatPanel";
import { RoomAskDialog } from "../../src/renderer/src/components/room/RoomAskDialog";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { gameAssistantMessageId } from "../../src/renderer/src/features/chat/gameAssistantMessage";
import "../../src/renderer/src/styles/index.css";

const roomId = "isolated-source-room";
const now = "2026-10-31T08:00:00Z";
useRoomStore.setState((s) => ({
  room: { ...s.room, roomId, connectionState: RoomConnectionState.Connected },
  chatMessages: [
    {
      id: "assistant",
      peerId: "author",
      nickname: "演示朋友",
      clientMessageId: gameAssistantMessageId(crypto.randomUUID()),
      content: "【提问】这波怎么配合？\n【回答】等大家到齐再开团，别让脚比嘴快。",
      createdAt: now,
    },
    {
      id: "friend",
      peerId: "friend",
      nickname: "演示朋友",
      content: "收到，集合再出发。",
      createdAt: now,
    },
  ],
}));
window.desktopApi = {
  ai: {
    askMemory: async () => ({
      text: "演示：约好十点集合，先补视野再出发。",
      sources: [
        {
          recordingId: "synthetic",
          filePath: "demo-only.m4a",
          segmentId: "a",
          roomId,
          roomName: "不应显示的频道名",
          createdAt: "2026-10-31T21:55:00+08:00",
          startMs: 605_000,
          quote: "今晚十点集合，先补视野再出发。",
        },
        {
          segmentId: "b",
          roomId: "another-room",
          createdAt: now,
          startMs: 10_000,
          quote: "其他频道不可见的记录",
        },
      ],
    }),
    cancelQuestion: async () => true,
  },
} as unknown as typeof window.desktopApi;
const noop = async () => {};
Object.assign(window, {
  sourceFixture: {
    switchRoom() {
      useRoomStore.setState((s) => ({ room: { ...s.room, roomId: "another-room" } }));
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main
      className="room-page"
      style={{
        display: "grid",
        gridTemplateColumns: "440px minmax(0,1fr)",
        gap: 20,
        height: "100vh",
        padding: 20,
      }}
    >
      <section style={{ position: "relative", minHeight: 0, overflow: "auto" }}>
        <RoomAskDialog
          roomId={roomId}
          isOpen
          inline
          reduceMotion
          canSend
          onClose={() => {}}
          onAssistantMoodChange={() => {}}
          onOpenResult={() => {}}
          onSendToChat={async (content, clientMessageId) => {
            useRoomStore.setState((s) => ({
              chatMessages: [
                ...s.chatMessages,
                {
                  id: crypto.randomUUID(),
                  peerId: "author",
                  nickname: "演示朋友",
                  content,
                  clientMessageId,
                  createdAt: now,
                },
              ],
            }));
          }}
        />
      </section>
      <RoomChatPanel
        sendChatMessage={noop}
        recallChatMessage={noop}
        sendQuickMessage={noop}
        sendConfiguredQuickMessage={noop}
        onOpenQuickMessageSettings={() => {}}
        onOpenRoomAi={() => {}}
        onCloseRoomAi={() => {}}
        isRoomAskOpen={false}
        roomAiPanel={null}
        assistantMood="idle"
        onAssistantMoodChange={() => {}}
        canSend
        reduceMotion
      />
    </main>
  </StrictMode>,
);
