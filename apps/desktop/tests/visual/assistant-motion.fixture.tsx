import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatAssistantWelcome } from "../../src/renderer/src/components/chat/ChatAssistantWelcome";
import { RoomAskDialog } from "../../src/renderer/src/components/room/RoomAskDialog";
import "../../src/renderer/src/styles/index.css";

localStorage.setItem(
  "shanghao:room-question-history:v2:main",
  JSON.stringify([
    {
      id: "fixture-history",
      question: "之前的问题",
      answer: { text: "测试回答", sources: [] },
      createdAt: "2026-10-18T00:00:00Z",
    },
  ]),
);

window.desktopApi = {
  ai: {
    askMemory: async () => ({
      text: "可以帮你解答游戏问题，也能查找房间里的语音记录。\n直接输入想问的问题就好。",
      sources: [],
    }),
    cancelQuestion: async () => true,
  },
} as unknown as typeof window.desktopApi;

const Fixture = () => {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <main className="room-page" style={{ width: 480, padding: 20 }}>
      <button id="fixture-open" onClick={() => setOpen(true)}>
        打开测试卡片
      </button>
      <ChatAssistantWelcome
        mood="idle"
        isOpen={open}
        isAsking={asking}
        onOpenAssistant={() => setAsking(true)}
        onClose={() => {
          setOpen(false);
          setAsking(false);
        }}
        roomAiPanel={
          <RoomAskDialog
            roomId="main"
            isOpen={asking}
            inline
            reduceMotion={false}
            canSend
            onClose={() => {
              setOpen(false);
              setAsking(false);
            }}
            onAssistantMoodChange={() => {}}
            onOpenResult={() => {}}
            onSendToChat={async () => {}}
          />
        }
      />
    </main>
  );
};
const runtime = globalThis as typeof globalThis & { assistantFixtureRoot?: Root };
runtime.assistantFixtureRoot ??= createRoot(document.getElementById("root")!);
runtime.assistantFixtureRoot.render(<Fixture />);
