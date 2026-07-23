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
  const sendControlRef = useRef<HTMLSpanElement>(null);
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
      window.requestAnimationFrame(() => {
        list.scrollTo({
          top: list.scrollHeight,
          behavior: shouldReduceMotion || previous === 0 ? "auto" : "smooth",
        });
      });
      setUnreadCount(0);
    } else if (messages.length > previous) {
      setUnreadCount((count) => count + messages.length - previous);
    }

    if (shouldReduceMotion || messages.length <= previous) return;

    const messageItems = list.querySelectorAll("[data-gsap-chat-message]");
    const latest = messageItems.item(messageItems.length - 1);
    if (!latest) return;

    const isSystemMessage = latestMessage?.kind === "system";
    const copy = latest.querySelector<HTMLElement>(".chat-message-copy");
    const avatar = latest.querySelector<HTMLElement>(".chat-message-avatar");
    const timeline = gsap.timeline({ defaults: { overwrite: true, force3D: true } });

    timeline.fromTo(
      latest,
      {
        autoAlpha: 0,
        x: isSystemMessage ? 0 : latestMessage?.isLocal ? 10 : -8,
        y: isSystemMessage ? 3 : 6,
        scale: isSystemMessage ? 0.99 : 0.94,
        transformOrigin: isSystemMessage ? "50% 100%" : "0% 65%",
      },
      {
        autoAlpha: 1,
        x: 0,
        y: 0,
        scale: 1,
        duration: motionDuration.message,
        ease: motionEase.jelly,
        clearProps: "transform,opacity,visibility",
      },
    );

    if (copy && !isSystemMessage) {
      timeline.fromTo(
        copy,
        {
          x: latestMessage?.isLocal ? 7 : -5,
          scale: 0.96,
          transformOrigin: "0% 65%",
        },
        {
          x: 0,
          scale: 1,
          duration: motionDuration.message * 0.9,
          ease: motionEase.jelly,
          clearProps: "transform",
        },
        0,
      );
    }

    if (avatar && !isSystemMessage) {
      timeline.fromTo(
        avatar,
        { autoAlpha: 0, scale: 0.78, y: 4 },
        {
          autoAlpha: 1,
          scale: 1,
          y: 0,
          duration: motionDuration.icon,
          ease: motionEase.jelly,
          clearProps: "transform,opacity,visibility",
        },
        0.035,
      );
    }
    return () => {
      timeline.kill();
    };
  }, [messages, shouldReduceMotion]);

  const animateSendFeedback = (source?: HTMLElement) => {
    if (shouldReduceMotion) return;
    if (source) {
      gsap.fromTo(
        source,
        { scale: 0.955 },
        {
          scale: 1,
          duration: motionDuration.feedback,
          ease: motionEase.spatial,
          clearProps: "transform",
        },
      );
    }

    const sendIcon = sendControlRef.current?.querySelector("svg");
    if (!sendIcon) return;
    const timeline = gsap.timeline({ defaults: { overwrite: true } });
    timeline
      .to(sendIcon, {
        x: 5,
        y: -5,
        scale: 0.82,
        autoAlpha: 0,
        duration: motionDuration.color,
        ease: "power2.in",
      })
      .set(sendIcon, { x: -4, y: 4, scale: 0.88 })
      .to(sendIcon, {
        x: 0,
        y: 0,
        scale: 1,
        autoAlpha: 1,
        duration: motionDuration.icon,
        ease: motionEase.spatial,
        clearProps: "transform,opacity,visibility",
      });
  };

  const handleSend = () => {
    if (!canSend || !chatInput.trim()) return;
    animateSendFeedback();
    onSend();
  };

  const handleQuickSend = (reply: string, source: HTMLButtonElement) => {
    const now = Date.now();
    if (now - lastQuickSendAt.current < 500) return;
    lastQuickSendAt.current = now;
    animateSendFeedback(source);
    onQuickSend?.(reply);
  };

  return (
    <div
      className={`temporary-chat-panel response-panel flex min-h-0 flex-col p-3 ${className}`.trim()}
      data-testid="temporary-chat-panel"
    >
      <div className="chat-panel-header flex items-center justify-between gap-2 border-b border-[rgba(220,230,242,0.6)] pb-2.5">
        <div className="chat-panel-title whitespace-nowrap text-[13px] font-semibold text-[#1a2332]">
          聊天
        </div>
        <div className="chat-quick-replies flex justify-end gap-1">
          {quickReplies.map((reply) => (
            <button
              key={reply}
              type="button"
              disabled={!canSend}
              className="chat-quick-reply interactive-surface min-h-[28px] min-w-[28px] rounded-[10px] border border-[rgba(220,230,242,0.8)] bg-white px-2 text-[11px] font-medium text-[#52657d] disabled:opacity-35 hover:bg-[#f5f7fb]"
              onClick={(event) => handleQuickSend(reply, event.currentTarget)}
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-2.5 min-h-0 flex-1">
        <div
          ref={listRef}
          className="chat-message-list h-full min-h-0 space-y-2.5 overflow-y-auto pr-1"
          onScroll={(event) => {
            const list = event.currentTarget;
            if (list.scrollHeight - list.scrollTop - list.clientHeight < 64) setUnreadCount(0);
          }}
        >
          {messages.length === 0 ? (
            <div className="chat-empty-state grid h-full min-h-[100px] place-items-center px-4 text-center text-[13px] leading-5 text-[#71839a]">
              {emptyMessage}
            </div>
          ) : (
            messages.slice(-100).map((message, index, visibleMessages) => {
              const previousMessage = visibleMessages[index - 1];
              const showDate =
                !previousMessage ||
                formatMessageDate(previousMessage.createdAt) !==
                  formatMessageDate(message.createdAt);
              return (
                <Fragment key={message.id}>
                  {showDate ? (
                    <div className="chat-date-divider">{formatMessageDate(message.createdAt)}</div>
                  ) : null}
                  {message.kind === "system" ? (
                    <div
                      data-gsap-chat-message
                      className="chat-system-message mx-auto w-fit max-w-[90%] rounded-full bg-[#f5f7fb] px-3 py-1 text-center text-[12px] leading-4 text-[#718096]"
                    >
                      {message.content}
                    </div>
                  ) : (
                    <div
                      data-gsap-chat-message
                      data-chat-direction={message.isLocal ? "outgoing" : "incoming"}
                      className="chat-message-row flex items-start gap-2"
                    >
                      <AvatarPlaceholder
                        name={message.nickname}
                        src={message.avatarDataUrl || getAvatarSrc(message.avatarId)}
                        size="sm"
                        className="chat-message-avatar mt-0.5 h-7 w-7 shrink-0 rounded-[10px]"
                      />
                      <div className="chat-message-copy flex max-w-[82%] flex-col items-start">
                        <span className="chat-message-name mb-0.5 px-1 text-[12px] font-medium leading-4 text-[#718096]">
                          {message.nickname}
                        </span>
                        <span
                          className={`chat-message-bubble rounded-[14px] px-3 py-1.5 text-[13px] leading-[1.4] ${
                            message.isLocal
                              ? "is-local rounded-tl-[4px] bg-[#EAF4FF] text-[#2F6FCC] border border-[rgba(126,184,249,0.25)]"
                              : "is-remote rounded-bl-[4px] bg-white text-[#374151] border border-[rgba(220,230,242,0.5)]"
                          }`}
                        >
                          {message.content}
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

      <div className="chat-composer mt-2.5 flex items-center gap-2 border-t border-[rgba(220,230,242,0.6)] pt-2.5">
        <Input
          placeholder={canSend ? "发一句..." : unavailableLabel}
          value={chatInput}
          disabled={!canSend}
          onChange={(event) => onChatInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && canSend) {
              event.preventDefault();
              handleSend();
            }
          }}
        />
        <span ref={sendControlRef} className="inline-flex shrink-0">
          <Button
            onClick={handleSend}
            disabled={!chatInput.trim() || !canSend}
            data-icon-motion="send"
            className="chat-send-button h-9 w-9 shrink-0 rounded-[10px] bg-[#4DA3FF] p-0 text-white hover:bg-[#3D8FEE]"
            aria-label="发送消息"
          >
            <Send className="h-4 w-4" />
          </Button>
        </span>
      </div>
    </div>
  );
};
