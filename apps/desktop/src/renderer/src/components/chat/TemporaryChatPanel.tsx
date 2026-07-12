import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { gsap } from "gsap";

import type { ChatMessage } from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

const quickReplies = ["👍", "上号", "开麦", "等我"];

const formatMessageTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const formatMessageDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
};

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
  reduceMotion = false,
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
  reduceMotion?: boolean;
}) => {
  const lastQuickSendAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const previousMessageCount = useRef(messages.length);
  const [unreadCount, setUnreadCount] = useState(0);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const previous = previousMessageCount.current;
    previousMessageCount.current = messages.length;
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
    const latestMessage = messages[messages.length - 1];
    if (wasNearBottom || latestMessage?.isLocal || previous === 0) {
      list.scrollTop = list.scrollHeight;
      setUnreadCount(0);
    } else if (messages.length > previous) {
      setUnreadCount((count) => count + messages.length - previous);
    }

    if (shouldReduceMotion || messages.length <= previous) return;

    const messageItems = list.querySelectorAll("[data-gsap-chat-message]");
    const latest = messageItems.item(messageItems.length - 1);
    if (!latest) return;

    gsap.fromTo(
      latest,
      { autoAlpha: 0, y: 8, scale: 0.985 },
      {
        autoAlpha: 1,
        y: 0,
        scale: 1,
        duration: motionDuration.feedback,
        ease: motionEase.feedback,
        overwrite: true,
        force3D: true,
      },
    );
  }, [messages, shouldReduceMotion]);

  const handleQuickSend = (reply: string) => {
    const now = Date.now();
    if (now - lastQuickSendAt.current < 500) return;
    lastQuickSendAt.current = now;
    onQuickSend?.(reply);
  };

  return (
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
              onClick={() => handleQuickSend(reply)}
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-2.5 min-h-0 flex-1">
        <div
          ref={listRef}
          className="h-full min-h-0 space-y-2.5 overflow-y-auto pr-1"
          onScroll={(event) => {
            const list = event.currentTarget;
            if (list.scrollHeight - list.scrollTop - list.clientHeight < 64) setUnreadCount(0);
          }}
        >
          {messages.length === 0 ? (
            <div className="grid h-full min-h-[100px] place-items-center px-4 text-center text-[13px] leading-5 text-[#71839a]">
              {emptyMessage}
            </div>
          ) : (
            messages.slice(-100).map((message, index, visibleMessages) => {
              const previousMessage = visibleMessages[index - 1];
              const showDate =
                !previousMessage ||
                formatMessageDate(previousMessage.createdAt) !==
                  formatMessageDate(message.createdAt);
              const previousAt = previousMessage
                ? new Date(previousMessage.createdAt).getTime()
                : 0;
              const currentAt = new Date(message.createdAt).getTime();
              const isGrouped = Boolean(
                previousMessage &&
                previousMessage.kind !== "system" &&
                message.kind !== "system" &&
                previousMessage.peerId === message.peerId &&
                previousMessage.isLocal === message.isLocal &&
                currentAt - previousAt >= 0 &&
                currentAt - previousAt < 5 * 60 * 1_000 &&
                !showDate,
              );
              return (
                <Fragment key={message.id}>
                  {showDate ? (
                    <div className="chat-date-divider">{formatMessageDate(message.createdAt)}</div>
                  ) : null}
                  {message.kind === "system" ? (
                    <div
                      data-gsap-chat-message
                      className="mx-auto w-fit max-w-[90%] rounded-full bg-[#f5f7fb] px-3 py-1 text-center text-[12px] leading-4 text-[#718096]"
                    >
                      {message.content}
                      <span className="ml-1.5 text-[11px] tabular-nums text-[#94a3b8]">
                        {formatMessageTime(message.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <div
                      data-gsap-chat-message
                      className={`flex items-end gap-1.5 ${message.isLocal ? "justify-end" : ""}`}
                    >
                      {!message.isLocal && !isGrouped ? (
                        <AvatarPlaceholder
                          name={message.nickname}
                          src={message.avatarDataUrl || getAvatarSrc(message.avatarId)}
                          size="sm"
                          className="h-7 w-7 shrink-0 rounded-[10px]"
                        />
                      ) : !message.isLocal ? (
                        <span className="h-7 w-7 shrink-0" aria-hidden="true" />
                      ) : null}
                      <div
                        className={`max-w-[78%] ${message.isLocal ? "items-end" : "items-start"} flex flex-col`}
                      >
                        {!message.isLocal && !isGrouped ? (
                          <span className="mb-0.5 px-1 text-[12px] font-medium leading-4 text-[#718096]">
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
                        <span
                          className={`mt-0.5 text-[11px] tabular-nums text-[#94a3b8] ${message.isLocal ? "text-right" : ""}`}
                        >
                          {formatMessageTime(message.createdAt)}
                        </span>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })
          )}
        </div>
        {unreadCount > 0 ? (
          <button
            type="button"
            className="chat-unread-button"
            onClick={() => {
              const list = listRef.current;
              if (list) list.scrollTop = list.scrollHeight;
              setUnreadCount(0);
            }}
          >
            {unreadCount} 条新消息
          </button>
        ) : null}
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
};
