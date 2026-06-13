import { MessageCircle, Send } from "lucide-react";

import type { ChatMessage } from "@private-voice/shared";

import { Button } from "../base/Button";
import { Input } from "../base/Input";

const emojiShortcuts = ["😄", "👍", "🎮", "🔥", "上号"];

export const TemporaryChatPanel = ({
  messages,
  chatInput,
  onChatInputChange,
  onSend,
  className = "",
  emptyMessage = "还没有消息。",
  canSend = false,
  unavailableLabel = "连接后可发送",
}: {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSend: () => void;
  className?: string;
  emptyMessage?: string;
  canSend?: boolean;
  unavailableLabel?: string;
}) => (
  <div
    className={`flex min-h-[376px] flex-col rounded-[24px] border border-[#E7ECF2] bg-white p-4 shadow-[0_18px_40px_rgba(17,24,39,0.06)] ${className}`.trim()}
    data-testid="temporary-chat-panel"
  >
    <div className="flex items-center gap-2 text-sm font-medium text-[#111827]">
      <MessageCircle className="h-4 w-4 text-[#4DA3FF]" />
      聊天
    </div>

    <div className="mt-3 flex min-h-0 flex-1 flex-col rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-3">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[190px] items-center justify-center rounded-[16px] border border-dashed border-[#D6DEE8] bg-white px-4 text-center text-sm text-[#98A2B3]">
            {emptyMessage}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`max-w-[88%] rounded-[16px] px-3 py-2 text-sm shadow-[0_4px_12px_rgba(17,24,39,0.04)] ${
                message.isLocal ? "ml-auto bg-[#4DA3FF] text-white" : "bg-white text-[#111827]"
              }`}
            >
              <div
                className={`text-[11px] ${
                  message.isLocal ? "text-white/80" : "text-[#98A2B3]"
                }`}
              >
                {message.nickname}
              </div>
              <div className="mt-1 break-words leading-6">{message.content}</div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {emojiShortcuts.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="rounded-full border border-[#E7ECF2] bg-white px-3 py-1 text-sm text-[#667085] transition hover:border-[#C7D7EB] hover:text-[#111827]"
            onClick={() => onChatInputChange(`${chatInput}${emoji}`)}
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="relative flex-1">
          <Input
            placeholder="发一句"
            value={chatInput}
            onChange={(event) => onChatInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && canSend) {
                event.preventDefault();
                onSend();
              }
            }}
          />
        </div>
        <Button onClick={onSend} disabled={!chatInput.trim() || !canSend} className="whitespace-nowrap">
          <Send className="h-4 w-4" />
          {canSend ? "发送" : unavailableLabel}
        </Button>
      </div>
    </div>
  </div>
);
