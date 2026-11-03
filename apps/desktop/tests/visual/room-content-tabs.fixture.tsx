import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RoomChatPanel } from "../../src/renderer/src/components/chat/RoomChatPanel";
import { MemberAvailabilityControls } from "../../src/renderer/src/components/chat/MemberAvailabilityControls";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import "../../src/renderer/src/styles/index.css";

const roomId = "isolated-tabs-room";
useRoomStore.setState((s) => ({
  room: { ...s.room, roomId },
  chatMessages: Array.from({ length: 30 }, (_, i) => ({
    id: `history-${i}`,
    peerId: "friend",
    nickname: "朋友",
    content: `历史消息 ${i}：今晚这波配合值得记下来。`,
    createdAt: new Date(Date.now() - 60_000 + i * 1000).toISOString(),
  })),
}));
Object.assign(window, {
  tabFixture: {
    message(id: string) {
      useRoomStore.setState((s) => ({
        chatMessages: [
          ...s.chatMessages,
          {
            id,
            peerId: "friend",
            nickname: "朋友",
            content: "新的隔离消息",
            createdAt: new Date().toISOString(),
          },
        ],
      }));
    },
    chronicle(entry = false) {
      useRoomStore.getState().setChronicle({
        type: "chronicle_state",
        roomId,
        available: true,
        state: {
          sessionId: "isolated-session",
          participants: ["friend"],
          entries: entry
            ? [
                {
                  id: "new-entry",
                  at: Date.now(),
                  text: "刚说稳一点，转头就冲进草丛；这一波，嘴比脚稳。",
                },
              ]
            : [],
        },
      });
    },
    repeat() {
      useRoomStore.setState((s) => ({
        chatMessages: [...s.chatMessages],
        chronicle: s.chronicle ? { ...s.chronicle } : undefined,
      }));
    },
  },
});
const noop = async () => {};
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main
      style={{
        height: "100vh",
        padding: 18,
        background: "linear-gradient(125deg,#daeafa,#eef5fe)",
      }}
    >
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
        presenceControls={<MemberAvailabilityControls canSend={false} send={noop} />}
        assistantMood="idle"
        onAssistantMoodChange={() => {}}
        canSend
        reduceMotion={new URLSearchParams(location.search).has("reduced")}
      />
    </main>
  </StrictMode>,
);
