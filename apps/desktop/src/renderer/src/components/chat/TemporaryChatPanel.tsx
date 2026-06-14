import { Send } from "lucide-react";
import { motion } from "framer-motion";

import type { ChatMessage } from "@private-voice/shared";

import { Button } from "../base/Button";
import { Input } from "../base/Input";

const quickReplies = ["👍", "🎮", "🔥", "上号", "等我", "来了", "开麦", "冲"];

export const TemporaryChatPanel = ({
  messages,
  chatInput,
  onChatInputChange,
  onSend,
  onQuickSend,
  className = "",
  emptyMessage = "敲一下，叫朋友上号。",
  canSend = false,
  unavailableLabel = "正在回来…",
}: {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSend: () => void;
  onQuickSend?: (message: string) => void;
  className?: string;
  emptyMessage?: string;
  canSend?: boolean;
  unavailableLabel?: string;
}) => (
  <div className={`response-panel flex min-h-0 flex-col p-4 ${className}`.trim()} data-testid="temporary-chat-panel">
    <div className="flex flex-wrap gap-2">
      {quickReplies.map((reply) => (
        <button
          key={reply}
          type="button"
          disabled={!canSend}
          className="interactive-surface whitespace-nowrap rounded-full border border-white/90 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#60738b] shadow-sm disabled:opacity-45"
          onClick={() => onQuickSend?.(reply)}
        >
          {reply}
        </button>
      ))}
    </div>

    <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
      {messages.length === 0 ? (
        <div className="grid h-full min-h-[150px] place-items-center text-center text-sm text-[#98a5b6]">{emptyMessage}</div>
      ) : (
        messages.slice(-24).map((message) => (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-baseline gap-2 text-sm ${message.isLocal ? "justify-end" : ""}`}
          >
            {!message.isLocal ? <span className="shrink-0 text-[11px] font-semibold text-[#8b99aa]">{message.nickname}</span> : null}
            <span className={`max-w-[75%] rounded-[14px] px-3 py-2 leading-5 ${message.isLocal ? "bg-[#eaf1ff] text-[#315b94]" : "bg-white/72 text-[#53647a]"}`}>
              {message.content}
            </span>
          </motion.div>
        ))
      )}
    </div>

    <div className="mt-3 flex items-center gap-2">
      <Input
        placeholder="发一句"
        value={chatInput}
        onChange={(event) => onChatInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && canSend) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      <Button onClick={onSend} disabled={!chatInput.trim() || !canSend} className="shrink-0 whitespace-nowrap">
        <Send className="h-4 w-4" />
        {canSend ? "发送" : unavailableLabel}
      </Button>
    </div>
  </div>
);
