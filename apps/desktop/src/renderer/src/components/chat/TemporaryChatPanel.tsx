import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  Bot,
  ExternalLink,
  Link2,
  LoaderCircle,
  Music2,
  Pause,
  RotateCcw,
  Settings2,
  Send,
} from "lucide-react";
import { gsap } from "gsap";

import {
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  QUICK_MESSAGE_PRESETS,
  type ChatMessage,
} from "@private-voice/shared";

import { getAvatarSrc } from "../../utils/profile";
import {
  findFirstMessageUrl,
  formatCompactUrl,
  getMessageUrlDetails,
  isMessageOnlyUrl,
} from "../../features/chat/linkPreview";
import { writeRoomCollectionDragPayload } from "../../features/chat/collectionDrag";
import { quickMessageCooldownMs } from "../../features/chat/quickReplies";
import {
  getQuickMessageAudioSnapshot,
  subscribeQuickMessageAudio,
} from "../../features/audio/quickMessageAudio";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { isSupportedChatImageFile } from "../../utils/chatImage";
import { ChatImageLightbox } from "./ChatImageLightbox";

const urlPattern = /https?:\/\/[^\s<，。！？；：）】》」]+/gi;
const trailingUrlPunctuation = /[.,!?，。！？;；:：)\]}>》」】]+$/;

const formatMessageDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric" });
};

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

const MessageLinkPreview = ({ url, onCopy }: { url: string; onCopy: (url: string) => void }) => {
  const details = getMessageUrlDetails(url);
  const [iconSrc, setIconSrc] = useState<string>();
  const [didIconFail, setDidIconFail] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setIconSrc(undefined);
    setDidIconFail(false);
    const getLinkPreviewIcon = window.desktopApi?.app?.getLinkPreviewIcon;
    if (typeof getLinkPreviewIcon !== "function") {
      setDidIconFail(true);
      return () => {
        isCurrent = false;
      };
    }
    void getLinkPreviewIcon(url)
      .then((value) => {
        if (isCurrent) setIconSrc(value);
      })
      .catch(() => {
        if (isCurrent) setDidIconFail(true);
      });
    return () => {
      isCurrent = false;
    };
  }, [url]);

  if (!details) return null;
  const compactUrl = formatCompactUrl(url);

  return (
    <button
      type="button"
      className="chat-link-preview"
      draggable
      aria-label={`在浏览器中打开 ${details.hostname}`}
      title={url}
      onClick={() => void window.desktopApi.app.openExternal(url)}
      onContextMenu={(event) => {
        event.preventDefault();
        onCopy(url);
      }}
      onDragStart={(event) => {
        writeRoomCollectionDragPayload(event.dataTransfer, {
          kind: "link",
          title: details.hostname,
          content: url,
        });
      }}
    >
      <span className="chat-link-preview-image" aria-hidden="true">
        {iconSrc && !didIconFail ? (
          <img src={iconSrc} alt="" draggable={false} onError={() => setDidIconFail(true)} />
        ) : (
          <Link2 />
        )}
      </span>
      <span className="chat-link-preview-copy">
        <strong>{details.hostname}</strong>
        <small>{compactUrl === details.hostname ? "点击打开网页" : compactUrl}</small>
      </span>
      <ExternalLink className="chat-link-preview-open" aria-hidden="true" />
    </button>
  );
};

export const TemporaryChatPanel = ({
  messages,
  chatInput,
  onChatInputChange,
  onSend,
  onQuickSend,
  onQuickMessageSend,
  onOpenQuickMessageSettings,
  onOpenRoomAi,
  onSendImage,
  onRecall,
  onRetry,
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
  onQuickMessageSend?: (presetId: string) => void;
  onOpenQuickMessageSettings?: () => void;
  onOpenRoomAi?: () => void;
  onSendImage?: (file: File) => Promise<void>;
  onRecall?: (messageId: string) => Promise<void>;
  onRetry?: (message: ChatMessage) => Promise<void>;
  className?: string;
  emptyMessage?: string;
  canSend?: boolean;
  unavailableLabel?: string;
  reduceMotion?: boolean;
}) => {
  const pushToast = useAppStore((state) => state.pushToast);
  const audioSnapshot = useSyncExternalStore(
    subscribeQuickMessageAudio,
    getQuickMessageAudioSnapshot,
    getQuickMessageAudioSnapshot,
  );
  const quickMessageSettings = useSettingsStore((state) => state.settings?.quickMessages);
  const quickMessageSlots = quickMessageSettings?.slots;
  const lastQuickSendAt = useRef(0);
  const lastQuickCooldownMs = useRef(3_000);
  const quickSendCooldownTimer = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const sendControlRef = useRef<HTMLSpanElement>(null);
  const dragDepthRef = useRef(0);
  const previousMessageCount = useRef(messages.length);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isSendingImage, setIsSendingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [previewMessageId, setPreviewMessageId] = useState<string | null>(null);
  const [previewDirection, setPreviewDirection] = useState<-1 | 0 | 1>(0);
  const previewOriginElements = useRef(new Map<string, HTMLButtonElement>());
  const [isQuickSendCoolingDown, setIsQuickSendCoolingDown] = useState(false);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);
  const quickMessages = useMemo(() => {
    const configured = (quickMessageSlots ?? [])
      .map((slot) => ({
        preset: QUICK_MESSAGE_PRESETS.find((candidate) => candidate.id === slot.presetId),
        shortcut: slot.shortcut,
        enabled: slot.enabled,
      }))
      .filter(
        (
          item,
        ): item is {
          preset: (typeof QUICK_MESSAGE_PRESETS)[number];
          shortcut: string;
          enabled: boolean;
        } => item.enabled && Boolean(item.preset),
      );
    return configured.length
      ? configured
      : QUICK_MESSAGE_PRESETS.filter((preset) => preset.mediaType !== "music").map((preset) => ({
          preset,
          shortcut: "",
          enabled: true,
        }));
  }, [quickMessageSlots]);
  const quickMusicItems = useMemo(() => {
    const musicSlots = Array.from(
      { length: DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length },
      (_, index) => {
        const fallback = DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[index] ??
          DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[0] ?? {
            presetId: undefined,
            shortcut: "",
            enabled: false,
          };
        const savedSlot = quickMessageSettings?.musicSlots?.[index];
        if (savedSlot) return savedSlot;
        return index === 0 && quickMessageSettings?.musicPresetId
          ? { ...fallback, presetId: quickMessageSettings.musicPresetId }
          : fallback;
      },
    );
    return musicSlots
      .map((slot) => ({
        preset: QUICK_MESSAGE_PRESETS.find((candidate) => candidate.id === slot.presetId),
        shortcut: slot.shortcut,
        enabled: slot.enabled,
      }))
      .filter(
        (
          item,
        ): item is {
          preset: (typeof QUICK_MESSAGE_PRESETS)[number];
          shortcut: string;
          enabled: boolean;
        } => item.enabled && item.preset?.mediaType === "music",
      );
  }, [quickMessageSettings?.musicPresetId, quickMessageSettings?.musicSlots]);

  useEffect(
    () => () => {
      if (quickSendCooldownTimer.current !== undefined) {
        window.clearTimeout(quickSendCooldownTimer.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const previous = previousMessageCount.current;
    previousMessageCount.current = messages.length;
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 96;
    const latestMessage = messages[messages.length - 1];
    if (wasNearBottom || latestMessage?.isLocal || previous === 0) {
      window.requestAnimationFrame(() => {
        const behavior =
          shouldReduceMotion || previous === 0 || latestMessage?.isLocal ? "auto" : "smooth";
        list.scrollTo({ top: list.scrollHeight, behavior });
        // Link cards and compressed-image previews can finish layout one frame
        // after the message row. Pin a locally sent message to the true bottom
        // again so the composer never clips its lower half.
        window.requestAnimationFrame(() => {
          if (latestMessage?.isLocal || previous === 0) list.scrollTop = list.scrollHeight;
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

  const handleQuickSend = (item: (typeof quickMessages)[number], source: HTMLButtonElement) => {
    const isPlayingMusic =
      item.preset.mediaType === "music" &&
      audioSnapshot.soundId === item.preset.soundId &&
      audioSnapshot.status === "playing";
    const isPausedMusic =
      item.preset.mediaType === "music" &&
      audioSnapshot.soundId === item.preset.soundId &&
      audioSnapshot.status === "paused";
    if (isPlayingMusic || isPausedMusic) {
      animateSendFeedback(source);
      onQuickMessageSend?.(item.preset.id);
      return;
    }
    const now = Date.now();
    const cooldownMs = quickMessageCooldownMs(item.preset);
    if (now - lastQuickSendAt.current < lastQuickCooldownMs.current) return;
    lastQuickSendAt.current = now;
    lastQuickCooldownMs.current = cooldownMs;
    setIsQuickSendCoolingDown(true);
    if (quickSendCooldownTimer.current !== undefined) {
      window.clearTimeout(quickSendCooldownTimer.current);
    }
    quickSendCooldownTimer.current = window.setTimeout(() => {
      quickSendCooldownTimer.current = undefined;
      setIsQuickSendCoolingDown(false);
    }, cooldownMs);
    animateSendFeedback(source);
    if (onQuickMessageSend) onQuickMessageSend(item.preset.id);
    else onQuickSend?.(item.preset.content);
  };

  const sendImageFile = (file?: File) => {
    if (!file || !isSupportedChatImageFile(file) || !canSend || !onSendImage || isSendingImage) {
      return;
    }
    setIsSendingImage(true);
    void onSendImage(file).finally(() => setIsSendingImage(false));
  };

  const findClipboardImage = (clipboardData: DataTransfer) => {
    const file = Array.from(clipboardData.files).find(isSupportedChatImageFile);
    if (file) return file;
    const imageItem = Array.from(clipboardData.items).find(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    return imageItem?.getAsFile() ?? undefined;
  };

  const copyLink = (url: string) => {
    void window.desktopApi.clipboard.writeText(url).then(
      () => pushToast({ tone: "success", title: "已复制链接" }),
      () => pushToast({ tone: "danger", title: "复制失败", description: "请稍后再试。" }),
    );
  };

  const copyText = (text: string) => {
    if (!text.trim()) return;
    void window.desktopApi.clipboard.writeText(text).then(
      () => pushToast({ tone: "success", title: "已复制消息" }),
      () => pushToast({ tone: "danger", title: "复制失败", description: "请稍后再试。" }),
    );
  };

  const copyImage = (dataUrl: string) => {
    if (!dataUrl) return;
    void (async () => {
      const source = new Image();
      source.decoding = "async";
      source.src = dataUrl;
      await source.decode();
      const canvas = document.createElement("canvas");
      canvas.width = source.naturalWidth;
      canvas.height = source.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("clipboard_canvas_unavailable");
      context.drawImage(source, 0, 0);
      await window.desktopApi.clipboard.writeImage(canvas.toDataURL("image/png"));
    })().then(
      () => pushToast({ tone: "success", title: "已复制图片" }),
      () =>
        pushToast({ tone: "danger", title: "复制失败", description: "图片暂时无法写入剪贴板。" }),
    );
  };

  const previewItems = messages.flatMap((message) =>
    message.image ? [{ messageId: message.id, image: message.image }] : [],
  );
  const previewIndex = previewMessageId
    ? previewItems.findIndex((item) => item.messageId === previewMessageId)
    : -1;
  const previewItem = previewIndex >= 0 ? previewItems[previewIndex] : undefined;
  const showPreviewImage = (offset: number) => {
    if (previewIndex < 0 || previewItems.length < 2) return;
    const nextIndex = (previewIndex + offset + previewItems.length) % previewItems.length;
    setPreviewDirection(offset < 0 ? -1 : 1);
    setPreviewMessageId(previewItems[nextIndex]?.messageId ?? null);
  };

  return (
    <>
      <div
        className={`temporary-chat-panel response-panel flex min-h-0 flex-col p-3 ${isDraggingImage ? "is-dragging-image" : ""} ${className}`.trim()}
        data-testid="temporary-chat-panel"
        onDragEnter={(event) => {
          if (
            !Array.from(event.dataTransfer.items).some(
              (item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")),
            )
          )
            return;
          event.preventDefault();
          dragDepthRef.current += 1;
          setIsDraggingImage(true);
        }}
        onDragOver={(event) => {
          if (
            !Array.from(event.dataTransfer.items).some(
              (item) => item.kind === "file" && (!item.type || item.type.startsWith("image/")),
            )
          )
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
          sendImageFile(Array.from(event.dataTransfer.files).find(isSupportedChatImageFile));
        }}
      >
        <div className="chat-panel-header flex items-center justify-between gap-2 border-b border-[rgba(220,230,242,0.6)] pb-2.5">
          <div className="chat-panel-title whitespace-nowrap text-[13px] font-semibold text-[#1a2332]">
            聊天
          </div>
          <div className="chat-quick-actions flex min-w-0 flex-col items-end gap-1">
            <div className="chat-quick-replies flex justify-end gap-1">
              {quickMessages.map((item, index) =>
                (() => {
                  const isPlayingMusic =
                    item.preset.mediaType === "music" &&
                    audioSnapshot.soundId === item.preset.soundId &&
                    audioSnapshot.status === "playing";
                  const isPausedMusic =
                    item.preset.mediaType === "music" &&
                    audioSnapshot.soundId === item.preset.soundId &&
                    audioSnapshot.status === "paused";
                  return (
                    <button
                      key={`${item.preset.id}-${index}`}
                      type="button"
                      disabled={
                        !canSend || (isQuickSendCoolingDown && !isPlayingMusic && !isPausedMusic)
                      }
                      className="chat-quick-reply interactive-surface inline-flex items-center gap-1.5 rounded-[9px] border border-[rgba(220,230,242,0.8)] bg-white font-medium text-[#52657d] disabled:opacity-35 hover:bg-[#f5f7fb]"
                      onClick={(event) => handleQuickSend(item, event.currentTarget)}
                      title={
                        item.shortcut
                          ? `${item.preset.content} · ${item.shortcut}`
                          : item.preset.content
                      }
                    >
                      {item.preset.mediaType === "music" ? (
                        isPlayingMusic ? (
                          <Pause
                            className="h-3.5 w-3.5 shrink-0 text-[#4D9BF3]"
                            aria-hidden="true"
                          />
                        ) : (
                          <Music2
                            className="h-3.5 w-3.5 shrink-0 text-[#4D9BF3]"
                            aria-hidden="true"
                          />
                        )
                      ) : null}
                      <span className="whitespace-nowrap">{item.preset.label}</span>
                    </button>
                  );
                })(),
              )}
              {onOpenQuickMessageSettings ? (
                <button
                  type="button"
                  className="chat-quick-reply interactive-surface rounded-[9px] border border-[rgba(220,230,242,0.8)] bg-white font-medium text-[#52657d] disabled:opacity-35 hover:bg-[#f5f7fb]"
                  aria-label="设置快捷消息"
                  title="设置快捷消息"
                  onClick={onOpenQuickMessageSettings}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            {quickMusicItems.length ? (
              <div
                className="chat-quick-music-row flex justify-end gap-1"
                aria-label="音乐快捷消息"
              >
                {quickMusicItems.map((item, index) => {
                  const isPlayingMusic =
                    audioSnapshot.soundId === item.preset.soundId &&
                    audioSnapshot.status === "playing";
                  const isPausedMusic =
                    audioSnapshot.soundId === item.preset.soundId &&
                    audioSnapshot.status === "paused";
                  return (
                    <button
                      key={`${item.preset.id}-${index}`}
                      type="button"
                      disabled={
                        !canSend || (isQuickSendCoolingDown && !isPlayingMusic && !isPausedMusic)
                      }
                      className="chat-quick-reply chat-quick-music interactive-surface inline-flex items-center gap-1 rounded-[9px] border bg-white font-medium disabled:opacity-35"
                      aria-label={`播放音乐：${item.preset.label}`}
                      title={`播放音乐：${item.preset.label}`}
                      onClick={(event) => handleQuickSend(item, event.currentTarget)}
                    >
                      {isPlayingMusic ? (
                        <Pause className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : (
                        <Music2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                      )}
                      <span className="whitespace-nowrap">{item.preset.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="relative mt-2.5 min-h-0 flex-1">
          {onOpenRoomAi ? (
            <div className="chat-ai-slot">
              <button
                type="button"
                className="chat-ai-entry interactive-surface"
                aria-label="打开上号 AI"
                title="打开上号 AI"
                onClick={onOpenRoomAi}
              >
                <Bot className="h-4 w-4" strokeWidth={2.15} aria-hidden="true" />
              </button>
            </div>
          ) : null}
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
                const linkPreviewUrl = message.content
                  ? findFirstMessageUrl(message.content)
                  : undefined;
                const shouldShowMessageBubble = Boolean(
                  message.content && !(linkPreviewUrl && isMessageOnlyUrl(message.content)),
                );
                const previousCreatedAt = Date.parse(previousMessage?.createdAt ?? "");
                const createdAt = Date.parse(message.createdAt);
                const isGrouped = Boolean(
                  previousMessage &&
                  previousMessage.kind !== "system" &&
                  previousMessage.peerId === message.peerId &&
                  formatMessageDate(previousMessage.createdAt) ===
                    formatMessageDate(message.createdAt) &&
                  Number.isFinite(previousCreatedAt) &&
                  Number.isFinite(createdAt) &&
                  createdAt - previousCreatedAt <= 5 * 60 * 1_000,
                );
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
                        onContextMenu={(event) => {
                          event.preventDefault();
                          copyText(message.content);
                        }}
                      >
                        {message.content}
                      </div>
                    ) : (
                      <div
                        data-gsap-chat-message
                        data-chat-direction={message.isLocal ? "outgoing" : "incoming"}
                        className={`chat-message-row flex min-w-0 items-start gap-2 ${isGrouped ? "is-grouped" : ""}`}
                      >
                        {isGrouped ? (
                          <span className="chat-message-avatar-spacer h-7 w-7 shrink-0" />
                        ) : (
                          <AvatarPlaceholder
                            name={message.nickname}
                            src={message.avatarDataUrl || getAvatarSrc(message.avatarId)}
                            size="sm"
                            className="chat-message-avatar mt-0.5 h-7 w-7 shrink-0 rounded-[10px]"
                          />
                        )}
                        <div className="chat-message-copy flex min-w-0 max-w-[82%] flex-col items-start">
                          {!isGrouped || (message.isLocal && onRecall) ? (
                            <span
                              className={`chat-message-meta mb-0.5 flex min-w-0 items-center gap-2 px-1 ${isGrouped ? "is-grouped" : ""}`}
                            >
                              {!isGrouped ? (
                                <span className="chat-message-name min-w-0 truncate text-[12px] font-medium leading-4 text-[#718096]">
                                  {message.nickname}
                                </span>
                              ) : null}
                              {message.isLocal && onRecall ? (
                                <button
                                  type="button"
                                  className="chat-message-recall-button inline-flex items-center gap-1 text-[11px] text-[#8a9ab0] hover:text-[#3974d8]"
                                  onClick={() => void onRecall(message.id)}
                                  title="撤回这条消息"
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  撤回
                                </button>
                              ) : null}
                            </span>
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
                              onClick={() => {
                                setPreviewDirection(0);
                                setPreviewMessageId(message.id);
                              }}
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
                                draggable={false}
                              />
                            </button>
                          ) : null}
                          {shouldShowMessageBubble ? (
                            <span
                              className={`chat-message-bubble max-w-full whitespace-pre-wrap break-words rounded-[14px] px-3 py-1.5 text-[13px] leading-[1.4] [overflow-wrap:anywhere] ${
                                message.isLocal
                                  ? "is-local rounded-tl-[4px] bg-[#EAF4FF] text-[#2F6FCC] border border-[rgba(126,184,249,0.25)]"
                                  : "is-remote rounded-bl-[4px] bg-white text-[#374151] border border-[rgba(220,230,242,0.5)]"
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
                              {renderMessageContent(message.content, copyLink)}
                            </span>
                          ) : null}
                          {linkPreviewUrl ? (
                            <MessageLinkPreview url={linkPreviewUrl} onCopy={copyLink} />
                          ) : null}
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
            placeholder={canSend ? "发送消息，最多保留最近 100 条" : unavailableLabel}
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
      {previewItem ? (
        <ChatImageLightbox
          image={previewItem.image}
          index={previewIndex}
          total={previewItems.length}
          direction={previewDirection}
          originElement={previewOriginElements.current.get(previewItem.messageId) ?? null}
          reduceMotion={shouldReduceMotion}
          onPrevious={() => showPreviewImage(-1)}
          onNext={() => showPreviewImage(1)}
          onCopy={copyImage}
          onClosed={() => setPreviewMessageId(null)}
        />
      ) : null}
    </>
  );
};
