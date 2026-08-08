import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Send, X } from "lucide-react";
import { gsap } from "gsap";

import type { ChatMessage } from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

const quickReplies = ["👍", "上号", "开麦", "等我"];
const urlPattern = /https?:\/\/[^\s<]+/gi;
const trailingUrlPunctuation = /[.,!?，。！？;；:：)\]}>》」】]+$/;

const formatMessageDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
};

const renderMessageContent = (content: string) => {
  const result: ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(urlPattern)) {
    const start = match.index ?? 0;
    const rawValue = match[0];
    const url = rawValue.replace(trailingUrlPunctuation, "");
    const suffix = rawValue.slice(url.length);
    if (start > cursor) result.push(content.slice(cursor, start));
    result.push(
      <a
        key={`${start}-${url}`}
        href={url}
        className="chat-message-link"
        onClick={(event) => {
          event.preventDefault();
          void window.desktopApi.app.openExternal(url);
        }}
      >
        {url}
      </a>,
    );
    if (suffix) result.push(suffix);
    cursor = start + rawValue.length;
  }

  if (cursor < content.length) result.push(content.slice(cursor));
  return result.length > 0 ? result : content;
};

export const TemporaryChatPanel = ({
  messages,
  chatInput,
  onChatInputChange,
  onSend,
  onQuickSend,
  onSendImage,
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
  onSendImage?: (file: File) => Promise<void>;
  className?: string;
  emptyMessage?: string;
  canSend?: boolean;
  unavailableLabel?: string;
  reduceMotion?: boolean;
}) => {
  const lastQuickSendAt = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const sendControlRef = useRef<HTMLSpanElement>(null);
  const dragDepthRef = useRef(0);
  const previousMessageCount = useRef(messages.length);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSendingImage, setIsSendingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<NonNullable<ChatMessage["image"]> | null>(null);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);

  useEffect(() => {
    if (!previewImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewImage(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage]);

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

  const sendImageFile = (file?: File) => {
    if (!file || !file.type.startsWith("image/") || !canSend || !onSendImage || isSendingImage) {
      return;
    }
    setIsSendingImage(true);
    void onSendImage(file).finally(() => setIsSendingImage(false));
  };

  const findClipboardImage = (clipboardData: DataTransfer) => {
    const file = Array.from(clipboardData.files).find((item) => item.type.startsWith("image/"));
    if (file) return file;
    const imageItem = Array.from(clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    return imageItem?.getAsFile() ?? undefined;
  };

  return (
    <>
      <div
        className={`temporary-chat-panel response-panel flex min-h-0 flex-col p-3 ${isDraggingImage ? "is-dragging-image" : ""} ${className}`.trim()}
        data-testid="temporary-chat-panel"
        onDragEnter={(event) => {
          if (!Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/")))
            return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setIsDraggingImage(true);
        }}
        onDragOver={(event) => {
          if (!Array.from(event.dataTransfer.items).some((item) => item.type.startsWith("image/")))
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setIsDraggingImage(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepthRef.current = 0;
          setIsDraggingImage(false);
          sendImageFile(
            Array.from(event.dataTransfer.files).find((file) => file.type.startsWith("image/")),
          );
        }}
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
            className="chat-message-list h-full min-h-0 space-y-2.5 overflow-x-hidden overflow-y-auto pr-1"
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
                      <div className="chat-date-divider">
                        {formatMessageDate(message.createdAt)}
                      </div>
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
                        className="chat-message-row flex min-w-0 items-start gap-2"
                      >
                        <AvatarPlaceholder
                          name={message.nickname}
                          src={message.avatarDataUrl || getAvatarSrc(message.avatarId)}
                          size="sm"
                          className="chat-message-avatar mt-0.5 h-7 w-7 shrink-0 rounded-[10px]"
                        />
                        <div className="chat-message-copy flex min-w-0 max-w-[82%] flex-col items-start">
                          <span className="chat-message-name mb-0.5 px-1 text-[12px] font-medium leading-4 text-[#718096]">
                            {message.nickname}
                          </span>
                          {message.image ? (
                            <button
                              type="button"
                              className="chat-image-thumbnail-button"
                              onClick={() => setPreviewImage(message.image ?? null)}
                              aria-label={`查看图片：${message.image.fileName || "聊天图片"}`}
                            >
                              <img
                                src={message.image.dataUrl}
                                alt={message.image.fileName || "聊天图片"}
                                width={message.image.width}
                                height={message.image.height}
                                className="chat-image-thumbnail"
                                loading="lazy"
                                draggable={false}
                              />
                            </button>
                          ) : null}
                          {message.content ? (
                            <span
                              className={`chat-message-bubble max-w-full whitespace-pre-wrap break-words rounded-[14px] px-3 py-1.5 text-[13px] leading-[1.4] [overflow-wrap:anywhere] ${
                                message.isLocal
                                  ? "is-local rounded-tl-[4px] bg-[#EAF4FF] text-[#2F6FCC] border border-[rgba(126,184,249,0.25)]"
                                  : "is-remote rounded-bl-[4px] bg-white text-[#374151] border border-[rgba(220,230,242,0.5)]"
                              }`}
                            >
                              {renderMessageContent(message.content)}
                            </span>
                          ) : null}
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
          {isSendingImage ? (
            <span className="chat-image-sending" aria-live="polite" title="正在压缩图片">
              <LoaderCircle className="h-4 w-4 animate-spin" />
            </span>
          ) : null}
          <Input
            placeholder={canSend ? "发一句，或粘贴 / 拖入图片..." : unavailableLabel}
            value={chatInput}
            disabled={!canSend}
            onChange={(event) => onChatInputChange(event.target.value)}
            onPaste={(event) => {
              const file = findClipboardImage(event.clipboardData);
              if (!file) return;
              event.preventDefault();
              sendImageFile(file);
            }}
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
        {isDraggingImage ? <div className="chat-image-drop-hint">松开即可压缩发送</div> : null}
      </div>
      {previewImage
        ? createPortal(
            <div
              className="chat-image-preview-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label="图片预览"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setPreviewImage(null);
              }}
            >
              <div className="chat-image-preview-surface">
                <button
                  type="button"
                  className="chat-image-preview-close"
                  onClick={() => setPreviewImage(null)}
                  aria-label="关闭图片预览"
                >
                  <X className="h-5 w-5" />
                </button>
                <img
                  src={previewImage.dataUrl}
                  alt={previewImage.fileName || "聊天图片"}
                  width={previewImage.width}
                  height={previewImage.height}
                  draggable={false}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
};
