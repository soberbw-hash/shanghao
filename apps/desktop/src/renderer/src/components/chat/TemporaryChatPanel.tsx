import { Send } from "lucide-react";
import { motion } from "framer-motion";

import type { ChatMessage } from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";
import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Button } from "../base/Button";
import { Input } from "../base/Input";

const quickReplies = ["👍", "上号", "开麦", "等我"];

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
    className={`response-panel flex min-h-0 flex-col p-3 ${className}`.trim()}
    data-testid="temporary-chat-panel"
  >
    <div className="flex items-center justify-between gap-2 border-b border-[rgba(220,230,242,0.6)] pb-2.5">
      <div className="whitespace-nowrap text-[13px] font-semibold text-[#1a2332]">聊天</div>
      <div className="flex flex-wrap justify-end gap-1">
        {quickReplies.map((reply) => (
          <button
            key={reply}
            type="button"
            disabled={!canSend}
            className="interactive-surface min-h-[28px] min-w-[28px] rounded-[10px] border border-[rgba(220,230,242,0.8)] bg-white px-2 text-[11px] font-medium text-[#52657d] disabled:opacity-35 hover:bg-[#f5f7fb]"
            onClick={() => onQuickSend?.(reply)}
          >
            {reply}
          </button>
        ))}
      </div>
    </div>

    <div className="mt-2.5 min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
      {messages.length === 0 ? (
        <div className="grid h-full min-h-[100px] place-items-center px-4 text-center text-[11px] leading-5 text-[#a0aec0]">
          {emptyMessage}
        </div>
      ) : (
        messages.slice(-32).map((message) =>
          message.kind === "system" ? (
            <motion.div
              key={message.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mx-auto w-fit max-w-[90%] rounded-full bg-[#f5f7fb] px-3 py-1 text-center text-[10px] text-[#8492a5]"
            >
              {message.content}
            </motion.div>
          ) : (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex items-end gap-1.5 ${message.isLocal ? "justify-end" : ""}`}
            >
              {!message.isLocal ? (
                <AvatarPlaceholder
                  name={message.nickname}
                  src={message.avatarDataUrl || getAvatarSrc(message.avatarId)}
                  size="sm"
                  className="h-7 w-7 shrink-0 rounded-[10px]"
                />
              ) : null}
              <div className={`max-w-[78%] ${message.isLocal ? "items-end" : "items-start"} flex flex-col`}>
                {!message.isLocal ? (
                  <span className="mb-0.5 px-1 text-[9px] font-medium text-[#a0aec0]">
                    {message.nickname}
                  </span>
                ) : null}
                <span
                  className={`rounded-[14px] px-3 py-1.5 text-[13px] leading-[1.4] ${
                    message.isLocal
                      ? "rounded-br-[4px] bg-[#EAF4FF] text-[#2F6FCC]"
                      : "rounded-bl-[4px] bg-white text-[#374151] border border-[rgba(220,230,242,0.5)]"
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

    <div className="mt-2.5 flex items-center gap-2 border-t border-[rgba(220,230,242,0.6)] pt-2.5">
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
        className="h-9 w-9 shrink-0 rounded-[10px] p-0 bg-[#4DA3FF] hover:bg-[#3D8FEE] text-white"
        aria-label="发送消息"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  </div>
);
