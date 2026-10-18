import type { AssistantBotMood } from "../../features/ai/useAssistantBotState";
import { AssistantBotAvatar } from "../room/AssistantBotAvatar";
import { AssistantBotCompanion } from "../room/AssistantBotCompanion";
import { useEffect, useState, type ReactNode } from "react";

export const ChatAssistantEntry = ({
  mood,
  isOpen,
  onToggle,
}: {
  mood: AssistantBotMood;
  isOpen: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    className="chat-ai-entry"
    aria-label={isOpen ? "收起 AI 助手" : "打开 AI 助手"}
    aria-expanded={isOpen}
    aria-controls="chat-ai-welcome"
    title={isOpen ? "收起 AI 助手" : "打开 AI 助手"}
    onClick={onToggle}
  >
    <AssistantBotAvatar mood={mood} size={32} />
  </button>
);

export const ChatAssistantWelcome = ({
  mood,
  isOpen,
  isAsking,
  roomAiPanel,
  onOpenAssistant,
  onClose,
}: {
  mood: AssistantBotMood;
  isOpen: boolean;
  isAsking: boolean;
  roomAiPanel: ReactNode;
  onOpenAssistant: () => void;
  onClose: () => void;
}) => {
  const [retainedAsking, setRetainedAsking] = useState(isAsking);
  useEffect(() => {
    if (isOpen) {
      setRetainedAsking(isAsking);
      return;
    }
    // Keep the expanded line until the shared close animation has finished.
    const timeout = window.setTimeout(() => setRetainedAsking(false), 280);
    return () => window.clearTimeout(timeout);
  }, [isAsking, isOpen]);
  const askingLayout = isAsking || (!isOpen && retainedAsking);

  return (
    <div className="chat-ai-welcome-shell" data-open={isOpen} data-asking={askingLayout}>
      <div className="chat-ai-welcome-clip">
        <aside
          id="chat-ai-welcome"
          className="chat-ai-welcome"
          aria-label="AI 助手欢迎卡片"
          aria-hidden={!isOpen}
          inert={!isOpen}
        >
          <AssistantBotCompanion mood={mood} active={isOpen} />
          <div className="chat-ai-welcome-copy">
            <strong>嗨，想问点什么？</strong>
            <div className="chat-ai-action-morph" data-asking={askingLayout}>
              {askingLayout ? (
                roomAiPanel
              ) : (
                <button type="button" className="chat-ai-welcome-action" onClick={onOpenAssistant}>
                  开始提问
                </button>
              )}
            </div>
          </div>
          <button
            type="button"
            className="chat-ai-welcome-close"
            aria-label="关闭 AI 助手卡片"
            onClick={onClose}
          >
            ×
          </button>
        </aside>
      </div>
    </div>
  );
};
