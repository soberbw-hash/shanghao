import { Fragment, memo, type ReactNode, type RefObject } from "react";
import { RotateCcw } from "lucide-react";
import type { ChatMessage } from "@private-voice/shared";

import { ChatAccountAvatar } from "./ChatAccountAvatar";
import { MessageLinkPreview } from "./MessageLinkPreview";
import { chatDisplayName, isGameAssistantMessage } from "../../features/chat/gameAssistantMessage";
import { formatCompactUrl, messageLinkCard } from "../../features/chat/linkPreview";
import { writeRoomCollectionDragPayload } from "../../features/chat/collectionDrag";
import { preloadChatImage } from "../../features/chat/chatImagePreload";

const urlPattern = /https?:\/\/[^\s<，。！？；：）】》」]+/gi;
const trailingUrlPunctuation = /[.,!?，。！？;；:：)\]}>》」】]+$/;

const messageDateFormat = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const localDay = (date: Date) =>
  date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate();

export const chatMessageKey = (message: ChatMessage) =>
  message.clientMessageId ? `client:${message.clientMessageId}` : `server:${message.id}`;

const renderMessageContent = (content: string, onCopyLink: (url: string) => void) => {
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
        onContextMenu={(event) => {
          event.preventDefault();
          onCopyLink(url);
        }}
      >
        {formatCompactUrl(url)}
      </a>,
    );
    if (suffix) result.push(suffix);
    cursor = start + rawValue.length;
  }

  if (cursor < content.length) result.push(content.slice(cursor));
  return result.length > 0 ? result : content;
};

interface ChatMessageRowsProps {
  messages: ChatMessage[];
  listStart: number;
  latestMessageElementRef: RefObject<HTMLDivElement | null>;
  previewOriginElements: RefObject<Map<string, HTMLButtonElement>>;
  openPreview: (messageId: string) => void;
  copyLink: (url: string) => void;
  copyText: (text: string) => void;
  copyImage: (url: string) => void;
  onRecall?: (messageId: string) => Promise<void>;
  onRetry?: (message: ChatMessage) => Promise<void>;
}

/** Keep message rows stable while the composer or an adjacent control updates. */
export const ChatMessageRows = memo(function ChatMessageRows({
  messages,
  listStart,
  latestMessageElementRef,
  previewOriginElements,
  openPreview,
  copyLink,
  copyText,
  copyImage,
  onRecall,
  onRetry,
}: ChatMessageRowsProps) {
  let previousDate = new Date(NaN);
  return messages.slice(listStart).map((message, index, visibleMessages) => {
    const previousMessage = visibleMessages[index - 1];
    const date = new Date(message.createdAt);
    const previousCreatedAt = previousDate.getTime();
    const createdAt = date.getTime();
    const sameDay = Object.is(localDay(previousDate), localDay(date));
    const showDate = !previousMessage || !sameDay;
    previousDate = date;
    const linkCard =
      message.content && !isGameAssistantMessage(message)
        ? messageLinkCard(message.content)
        : undefined;
    const shouldShowMessageBubble = Boolean(message.content && !linkCard);
    const isGrouped = Boolean(
      previousMessage &&
      previousMessage.kind !== "system" &&
      previousMessage.peerId === message.peerId &&
      isGameAssistantMessage(previousMessage) === isGameAssistantMessage(message) &&
      sameDay &&
      Number.isFinite(previousCreatedAt) &&
      Number.isFinite(createdAt) &&
      createdAt - previousCreatedAt <= 5 * 60 * 1_000,
    );
    return (
      <Fragment key={chatMessageKey(message)}>
        {showDate ? (
          <div className="chat-date-divider">
            {Number.isFinite(createdAt) ? messageDateFormat.format(date) : ""}
          </div>
        ) : null}
        {message.kind === "system" ? (
          <div
            ref={index === visibleMessages.length - 1 ? latestMessageElementRef : undefined}
            data-gsap-chat-message
            className="chat-system-message mx-auto w-fit max-w-[90%] rounded-full px-3 py-1 text-center text-[12px] leading-4"
            data-message-id={message.id}
            onContextMenu={(event) => {
              event.preventDefault();
              copyText(message.content);
            }}
          >
            {message.content}
          </div>
        ) : (
          <div
            ref={index === visibleMessages.length - 1 ? latestMessageElementRef : undefined}
            data-gsap-chat-message
            data-chat-direction={
              message.isLocal && !isGameAssistantMessage(message) ? "outgoing" : "incoming"
            }
            data-message-id={message.id}
            className={`chat-message-row flex min-w-0 items-start gap-2 ${isGrouped ? "is-grouped" : ""}`}
          >
            {isGrouped ? (
              <span className="chat-message-avatar-spacer h-7 w-7 shrink-0" />
            ) : (
              <ChatAccountAvatar message={message} />
            )}
            <div className="chat-message-copy relative flex min-w-0 max-w-[82%] flex-col items-start">
              {!isGrouped ? (
                <span className="chat-message-meta mb-0.5 flex min-w-0 items-center gap-2 px-1">
                  <span className="chat-message-name min-w-0 truncate text-[12px] font-medium leading-4 text-[#718096]">
                    {chatDisplayName(message)}
                  </span>
                </span>
              ) : null}
              {message.isLocal && onRecall ? (
                <button
                  type="button"
                  className="chat-message-recall-button inline-flex items-center gap-1 text-[11px] text-[#8a9ab0] hover:text-[#3974d8]"
                  onClick={() => void onRecall(message.id)}
                  title="撤回这条消息"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  撤回
                </button>
              ) : null}
              {message.image ? (
                <button
                  ref={(element) => {
                    if (element) previewOriginElements.current.set(message.id, element);
                    else previewOriginElements.current.delete(message.id);
                  }}
                  type="button"
                  className="chat-image-thumbnail-button"
                  draggable
                  onPointerEnter={() => void preloadChatImage(message.image?.dataUrl ?? "")}
                  onPointerDown={() => void preloadChatImage(message.image?.dataUrl ?? "")}
                  onClick={() => openPreview(message.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    copyImage(message.image?.dataUrl ?? "");
                  }}
                  onDragStart={(event) => {
                    writeRoomCollectionDragPayload(event.dataTransfer, {
                      kind: "image",
                      title: message.image?.fileName || `${message.nickname} 的图片`,
                      content: message.image?.dataUrl ?? "",
                    });
                  }}
                  aria-label={`查看图片：${message.image.fileName || "聊天图片"}`}
                >
                  <img
                    src={message.image.dataUrl}
                    alt={message.image.fileName || "聊天图片"}
                    width={message.image.width}
                    height={message.image.height}
                    className="chat-image-thumbnail"
                    loading="lazy"
                    onLoad={() => void preloadChatImage(message.image?.dataUrl ?? "")}
                    draggable={false}
                  />
                </button>
              ) : null}
              {shouldShowMessageBubble ? (
                <span
                  className={`chat-message-bubble max-w-full whitespace-pre-wrap break-words rounded-[14px] px-3 py-1.5 text-[13px] leading-[1.4] [overflow-wrap:anywhere] ${
                    message.isLocal && !isGameAssistantMessage(message)
                      ? "is-local rounded-tl-[4px] bg-[#EAF4FF] text-[#2F6FCC] border border-[rgba(126,184,249,0.25)]"
                      : `${isGameAssistantMessage(message) ? "is-assistant rounded-tl-[4px]" : "rounded-bl-[4px]"} is-remote bg-white text-[#374151] border border-[rgba(220,230,242,0.5)]`
                  }`}
                  draggable
                  onDragStart={(event) => {
                    writeRoomCollectionDragPayload(event.dataTransfer, {
                      kind: "text",
                      title: message.content.slice(0, 36),
                      content: message.content,
                    });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    copyText(message.content);
                  }}
                >
                  {isGameAssistantMessage(message) &&
                  message.content.startsWith("【提问】") &&
                  message.content.includes("\n【回答】") ? (
                    (() => {
                      const split = message.content.indexOf("\n【回答】");
                      return (
                        <>
                          <span className="mb-2 block rounded-lg bg-[#e8f2ff] px-2 py-1 text-[12px] font-semibold text-[#34699e]">
                            {message.content.slice(4, split)}
                          </span>
                          <span className="block">
                            {renderMessageContent(message.content.slice(split + 5), copyLink)}
                          </span>
                        </>
                      );
                    })()
                  ) : isGameAssistantMessage(message) &&
                    message.content.startsWith("【相关记录】") ? (
                    <>
                      <span className="mb-1 block text-[12px] font-semibold text-[#3974d8]">
                        相关记录
                      </span>
                      {renderMessageContent(message.content.slice(6), copyLink)}
                    </>
                  ) : (
                    renderMessageContent(message.content, copyLink)
                  )}
                </span>
              ) : null}
              {linkCard ? <MessageLinkPreview {...linkCard} onCopy={copyLink} /> : null}
              {message.isLocal && message.deliveryState === "failed" ? (
                <button
                  type="button"
                  className="chat-delivery-state is-failed"
                  onClick={() => void onRetry?.(message)}
                >
                  发送失败 · 重新发送
                </button>
              ) : null}
            </div>
          </div>
        )}
      </Fragment>
    );
  });
});
