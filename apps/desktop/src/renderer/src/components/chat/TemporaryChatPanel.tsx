import { Send, SmilePlus } from "lucide-react";
import { motion } from "framer-motion";

import type { ChatMessage } from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";
import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Button } from "../base/Button";
import { Input } from "../base/Input";

const quickReplies = ["👍", "🎮", "🔥", "上号", "开麦", "等我", "来了", "冲"];

export const TemporaryChatPanel = ({
  messages,
  chatInput,
  onChatInputChange,
  onSend,
  onQuickSend,
  className = "",
  emptyMessage = "频道里还很安静，先说一句吧。",
  canSend = false,
  unavailableLabel = "重连中",
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
  <div
    className={`response-panel flex min-h-0 flex-col p-3.5 ${className}`.trim()}
    data-testid="temporary-chat-panel"
  >
    <div className="flex items-center justify-between gap-3 border-b border-[#e9eef5] pb-3">
      <div>
        <div className="text-sm font-bold text-[#27364a]">临时聊天</div>
        <div className="mt-0.5 text-[11px] text-[#93a0b1]">只在当前频道保留</div>
      </div>
      <div className="flex max-w-[70%] flex-wrap justify-end gap-1">
        {quickReplies.map((reply) => (
          <button
            key={reply}
            type="button"
            disabled={!canSend}
            className="interactive-surface grid min-h-7 min-w-7 place-items-center rounded-full border border-[#e8edf4] bg-white px-2 text-xs disabled:opacity-40"
            onClick={() => onQuickSend?.(reply)}
          >
            {reply}
          </button>
        ))}
      </div>
    </div>

    <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      {messages.length === 0 ? (
        <div className="grid h-full min-h-[120px] place-items-center px-5 text-center text-xs leading-5 text-[#9aa6b5]">
          {emptyMessage}
        </div>
      ) : (
        messages.slice(-32).map((message) =>
          message.kind === "system" ? (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mx-auto w-fit max-w-[90%] rounded-full bg-[#f2f5f9] px-3 py-1.5 text-center text-[11px] text-[#8492a5]"
            >
              {message.content}
            </motion.div>
          ) : (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex items-end gap-2 ${message.isLocal ? "justify-end" : ""}`}
            >
              {!message.isLocal ? (
                <AvatarPlaceholder
                  name={message.nickname}
                  src={message.avatarDataUrl || getAvatarSrc(message.avatarId)}
                  size="sm"
                  className="h-8 w-8 shrink-0 rounded-[11px]"
                />
              ) : null}
              <div className={`max-w-[76%] ${message.isLocal ? "items-end" : "items-start"} flex flex-col`}>
                {!message.isLocal ? (
                  <span className="mb-1 px-1 text-[10px] font-semibold text-[#94a0af]">
                    {message.nickname}
                  </span>
                ) : null}
                <span
                  className={`rounded-[15px] px-3 py-2 text-sm leading-5 ${
                    message.isLocal
                      ? "rounded-br-[5px] bg-[#e7efff] text-[#315b94]"
                      : "rounded-bl-[5px] bg-white text-[#53647a] shadow-sm"
                  }`}
                >
                  {message.content}
                </span>
              </div>
            </motion.div>
          ),
        )
      )}
    </div>

    <div className="mt-3 flex items-center gap-2 border-t border-[#e9eef5] pt-3">
      <button
        type="button"
        disabled={!canSend}
        className="interactive-surface grid h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#e4eaf2] bg-white text-[#70839a] disabled:opacity-40"
        onClick={() => onQuickSend?.("😊")}
        aria-label="发送表情"
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      <Input
        placeholder={canSend ? "发一句..." : unavailableLabel}
        value={chatInput}
        disabled={!canSend}
        onChange={(event) => onChatInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && canSend) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      <Button
        onClick={onSend}
        disabled={!chatInput.trim() || !canSend}
        className="h-10 w-10 shrink-0 rounded-[13px] p-0"
        aria-label="发送消息"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  </div>
);
