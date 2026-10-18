import { useState, type ReactNode } from "react";
import { Settings2 } from "lucide-react";
import type { AssistantBotMood } from "../../features/ai/useAssistantBotState";
import { ChatAssistantEntry, ChatAssistantWelcome } from "./ChatAssistantWelcome";

export const ChatPanelHeader = ({
  mood,
  isAsking,
  roomAiPanel,
  onOpenAssistant,
  onCloseAssistant,
  onOpenQuickSettings,
  children,
}: {
  mood: AssistantBotMood;
  isAsking: boolean;
  roomAiPanel: ReactNode;
  onOpenAssistant?: () => void;
  onCloseAssistant?: () => void;
  onOpenQuickSettings?: () => void;
  children: ReactNode;
}) => {
  const [isWelcomeOpen, setWelcomeOpen] = useState(false);
  const close = () => {
    setWelcomeOpen(false);
    if (isAsking) onCloseAssistant?.();
  };
  return (
    <div className="chat-panel-header flex flex-col items-stretch gap-2 border-b border-[rgba(220,230,242,0.6)] pb-2.5">
      <div className="chat-panel-title-row flex items-center justify-between gap-3">
        <div className="chat-panel-title whitespace-nowrap text-[13px] font-semibold text-[#1a2332]">
          聊天
        </div>
        <div className="chat-title-actions flex shrink-0 items-center gap-2.5">
          {onOpenAssistant ? (
            <ChatAssistantEntry
              mood={mood}
              isOpen={isWelcomeOpen}
              onToggle={() => {
                if (isWelcomeOpen) close();
                else setWelcomeOpen(true);
              }}
            />
          ) : null}
          {onOpenQuickSettings ? (
            <button
              type="button"
              className="chat-settings-button interactive-surface flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border border-[rgba(220,230,242,0.8)] bg-white text-[#52657d] hover:bg-[#f5f7fb]"
              aria-label="设置快捷消息"
              title="设置快捷消息"
              onClick={onOpenQuickSettings}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      {children}
      {onOpenAssistant ? (
        <ChatAssistantWelcome
          mood={mood}
          isOpen={isWelcomeOpen}
          isAsking={isAsking}
          roomAiPanel={roomAiPanel}
          onOpenAssistant={onOpenAssistant}
          onClose={close}
        />
      ) : null}
    </div>
  );
};
