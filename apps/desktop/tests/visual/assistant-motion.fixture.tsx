import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatAssistantWelcome } from "../../src/renderer/src/components/chat/ChatAssistantWelcome";
import "../../src/renderer/src/styles/index.css";

const Fixture = () => {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  return (
    <main style={{ width: 480, padding: 20 }}>
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
          asking ? (
            <div className="room-ask-inline">
              <div className="room-ai-composer">
                <input placeholder="输入问题" />
                <button className="room-ai-send">↑</button>
              </div>
            </div>
          ) : null
        }
      />
    </main>
  );
};
createRoot(document.getElementById("root")!).render(<Fixture />);
