import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LoaderCircle, Plus, Send } from "lucide-react";
import { gsap } from "gsap";

import {
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  DEFAULT_QUICK_MESSAGE_SLOTS,
  QUICK_MESSAGE_PRESETS,
  normalizeQuickMessageSlots,
  type ChatMessage,
} from "@private-voice/shared";

import { ChatMessageRows } from "./ChatMessageRows";
import { QuickMessageRow } from "./QuickMessageRow";
import { preloadAdjacentChatImages } from "../../features/chat/chatImagePreload";
import { quickMessageCooldownMs } from "../../features/chat/quickReplies";
import {
  getQuickMessageAudioSnapshot,
  subscribeQuickMessageAudio,
} from "../../features/audio/quickMessageAudio";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { isSupportedChatImageFile } from "../../utils/chatImage";
import { ChatImageLightbox } from "./ChatImageLightbox";
import { useNoticeMessageFocus } from "../../features/chat/useNoticeMessageFocus";
import type { AssistantBotMood } from "../../features/ai/useAssistantBotState";
import { ChatPanelHeader } from "./ChatPanelHeader";
import { ChatContentSwitcher } from "./ChatContentSwitcher";
import { useScrollEdgeFade } from "../../features/motion/useScrollEdgeFade";

export const TemporaryChatPanel = ({
  messages,
  chatInput,
  onChatInputChange,
  onSend,
  onQuickSend,
  onQuickMessageSend,
  onOpenQuickMessageSettings,
  onOpenRoomAi,
  onCloseRoomAi,
  isRoomAskOpen = false,
  roomAiPanel,
  presenceControls,
  assistantMood = "idle",
  onSendImage,
  onRecall,
  onRetry,
  className = "",
  emptyMessage = "频道里还很安静，先说一句吧。",
  canSend = false,
  unavailableLabel = "重连中",
  reduceMotion = false,
  panelTitle,
  alternateContent,
  alternateContentActive = !!alternateContent,
  contentTabId,
  focusedMessage,
}: {
  messages: ChatMessage[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSend: () => void;
  onQuickSend?: (message: string) => void;
  onQuickMessageSend?: (presetId: string) => void;
  onOpenQuickMessageSettings?: () => void;
  onOpenRoomAi?: () => void;
  onCloseRoomAi?: () => void;
  isRoomAskOpen?: boolean;
  roomAiPanel?: ReactNode;
  presenceControls?: ReactNode;
  assistantMood?: AssistantBotMood;
  onSendImage?: (file: File) => Promise<void>;
  onRecall?: (messageId: string) => Promise<void>;
  onRetry?: (message: ChatMessage) => Promise<void>;
  className?: string;
  emptyMessage?: string;
  canSend?: boolean;
  unavailableLabel?: string;
  reduceMotion?: boolean;
  panelTitle?: ReactNode;
  alternateContent?: ReactNode;
  alternateContentActive?: boolean;
  contentTabId?: string;
  focusedMessage?: { messageId?: string };
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
  const { listStart, listRef } = useNoticeMessageFocus(
    messages,
    focusedMessage,
    alternateContentActive,
  );
  const latestMessageElementRef = useRef<HTMLDivElement>(null);
  const sendControlRef = useRef<HTMLSpanElement>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const hasDraft = chatInput.trim().length > 0;
  const attachImage = !hasDraft && Boolean(onSendImage);
  useScrollEdgeFade(listRef, !alternateContentActive && messages.length > 0);
  const dragDepthRef = useRef(0);
  // The first render can already contain restored history. Treat it as an
  // initial batch so the chat opens at the newest message rather than the top.
  const previousMessageCount = useRef(0);
  const [isSendingImage, setIsSendingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [previewMessageId, setPreviewMessageId] = useState<string | null>(null);
  const [previewDirection, setPreviewDirection] = useState<-1 | 0 | 1>(0);
  const previewOriginElements = useRef(new Map<string, HTMLButtonElement>());
  const [isQuickSendCoolingDown, setIsQuickSendCoolingDown] = useState(false);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);
  const shortcutsEnabled = quickMessageSettings?.shortcutsEnabled === true;
  const quickMessages = useMemo(() => {
    const configured = normalizeQuickMessageSlots(
      quickMessageSlots,
      DEFAULT_QUICK_MESSAGE_SLOTS,
      DEFAULT_QUICK_MESSAGE_SLOTS.length,
    )
      .map((slot) => ({
        preset: QUICK_MESSAGE_PRESETS.find((candidate) => candidate.id === slot.presetId),
        shortcut: slot.shortcut,
        enabled: shortcutsEnabled && slot.enabled,
      }))
      .filter(
        (
          item,
        ): item is {
          preset: (typeof QUICK_MESSAGE_PRESETS)[number];
          shortcut: string;
          enabled: boolean;
        } => Boolean(item.preset),
      );
    return configured.filter((item) => item.preset.mediaType !== "music");
  }, [quickMessageSlots, shortcutsEnabled]);
  const quickMusicItems = useMemo(() => {
    const musicSlots = normalizeQuickMessageSlots(
      quickMessageSettings?.musicSlots?.length
        ? quickMessageSettings.musicSlots
        : quickMessageSettings?.musicPresetId
          ? [
              {
                ...DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS[0],
                presetId: quickMessageSettings.musicPresetId,
              },
            ]
          : quickMessageSettings?.musicSlots,
      DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
      DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length,
    );
    return musicSlots
      .map((slot) => ({
        preset: QUICK_MESSAGE_PRESETS.find((candidate) => candidate.id === slot.presetId),
        shortcut: slot.shortcut,
        enabled: shortcutsEnabled && slot.enabled,
      }))
      .filter(
        (
          item,
        ): item is {
          preset: (typeof QUICK_MESSAGE_PRESETS)[number];
          shortcut: string;
          enabled: boolean;
        } => item.preset?.mediaType === "music",
      );
  }, [quickMessageSettings, shortcutsEnabled]);

  useEffect(
    () => () => {
      if (quickSendCooldownTimer.current !== undefined) {
        window.clearTimeout(quickSendCooldownTimer.current);
      }
    },
    [],
  );

  const newestId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && newestId) list.scrollTop = list.scrollHeight;
  }, [newestId, listRef]);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const previous = previousMessageCount.current;
    previousMessageCount.current = messages.length;
    const latestMessage = messages.at(-1);
    if (shouldReduceMotion || messages.length <= previous) return;

    const latest = latestMessageElementRef.current;
    if (!latest) return;

    const isSystemMessage = latestMessage?.kind === "system";
    const copy = latest.querySelector<HTMLElement>(".chat-message-copy");
    const avatar = latest.querySelector<HTMLElement>(".chat-message-avatar");
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { overwrite: true, force3D: true } });
      timeline.fromTo(
        latest,
        {
          autoAlpha: isSystemMessage ? 1 : 0,
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
    }, list);
    // Restore inline styles when message updates interrupt the entry animation.
    return () => context.revert();
  }, [messages, shouldReduceMotion, listRef]);

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

  const copyLink = useCallback(
    (url: string) => {
      void window.desktopApi.clipboard.writeText(url).then(
        () => pushToast({ tone: "success", title: "已复制链接" }),
        () => pushToast({ tone: "danger", title: "复制失败", description: "请稍后再试。" }),
      );
    },
    [pushToast],
  );

  const copyText = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      void window.desktopApi.clipboard.writeText(text).then(
        () => pushToast({ tone: "success", title: "已复制消息" }),
        () => pushToast({ tone: "danger", title: "复制失败", description: "请稍后再试。" }),
      );
    },
    [pushToast],
  );

  const copyImage = useCallback(
    (dataUrl: string) => {
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
    },
    [pushToast],
  );

  const openPreview = useCallback((messageId: string) => {
    setPreviewDirection(0);
    setPreviewMessageId(messageId);
  }, []);
  const previewItems = useMemo(
    () =>
      messages.flatMap((message) =>
        message.image ? [{ messageId: message.id, image: message.image }] : [],
      ),
    [messages],
  );
  const previewIndex = previewMessageId
    ? previewItems.findIndex((item) => item.messageId === previewMessageId)
    : -1;
  const previewItem = previewIndex >= 0 ? previewItems[previewIndex] : undefined;
  useEffect(() => {
    if (previewIndex < 0) return;
    preloadAdjacentChatImages(
      previewItems.map((item) => item.image.dataUrl),
      previewIndex,
    );
  }, [previewIndex, previewItems]);
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
        <ChatPanelHeader
          title={panelTitle}
          mood={assistantMood}
          presenceControls={presenceControls}
          isAsking={isRoomAskOpen}
          roomAiPanel={roomAiPanel}
          onOpenAssistant={onOpenRoomAi}
          onCloseAssistant={onCloseRoomAi}
          onOpenQuickSettings={onOpenQuickMessageSettings}
        >
          <div className="chat-quick-actions flex min-w-0 flex-col items-end gap-1">
            <QuickMessageRow
              items={quickMessages}
              canSend={canSend}
              coolingDown={isQuickSendCoolingDown}
              soundId={audioSnapshot.soundId}
              status={audioSnapshot.status}
              onSend={handleQuickSend}
            />
            {quickMusicItems.length ? (
              <QuickMessageRow
                music
                items={quickMusicItems}
                canSend={canSend}
                coolingDown={isQuickSendCoolingDown}
                soundId={audioSnapshot.soundId}
                status={audioSnapshot.status}
                onSend={handleQuickSend}
              />
            ) : null}
          </div>
        </ChatPanelHeader>

        <ChatContentSwitcher
          alternate={alternateContent}
          active={alternateContentActive}
          reduceMotion={shouldReduceMotion}
          idPrefix={contentTabId}
        >
          <div className="room-list-viewport" data-room-list-edge={messages.length > 0}>
            <span className="room-list-top-edge" aria-hidden="true" />
            <div
              ref={listRef}
              className="chat-message-list flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto pr-1"
            >
              {messages.length === 0 ? (
                <div className="chat-empty-state grid h-full min-h-[100px] place-items-center px-4 text-center text-[13px] leading-5 text-[#536c87]">
                  {canSend ? emptyMessage : "连接恢复后可以发送消息。"}
                </div>
              ) : (
                <ChatMessageRows
                  messages={messages}
                  listStart={listStart}
                  latestMessageElementRef={latestMessageElementRef}
                  previewOriginElements={previewOriginElements}
                  openPreview={openPreview}
                  copyLink={copyLink}
                  copyText={copyText}
                  copyImage={copyImage}
                  onRecall={onRecall}
                  onRetry={onRetry}
                />
              )}
            </div>
          </div>

          <div
            className="chat-composer"
            data-has-draft={hasDraft}
            data-reduce-motion={shouldReduceMotion}
          >
            {isSendingImage ? (
              <span className="chat-image-sending" aria-live="polite" title="正在压缩图片">
                <LoaderCircle className="h-4 w-4 animate-spin" />
              </span>
            ) : null}
            <Input
              aria-label="聊天消息"
              placeholder={canSend ? "发送消息…" : messages.length ? unavailableLabel : "发送消息"}
              title="最多保留最近 100 条消息"
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
                if (
                  event.key === "Enter" &&
                  !event.nativeEvent.isComposing &&
                  !event.shiftKey &&
                  !event.ctrlKey &&
                  canSend
                ) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            {onSendImage && (
              <input
                ref={imagePicker}
                type="file"
                hidden
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  sendImageFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            )}
            <span ref={sendControlRef} className="inline-flex shrink-0">
              <Button
                onClick={attachImage ? () => imagePicker.current?.click() : handleSend}
                disabled={!canSend || (attachImage ? isSendingImage : !hasDraft)}
                data-attachment={attachImage}
                data-icon-motion="send"
                className="chat-send-button h-9 w-9 shrink-0 rounded-[10px] bg-[#4DA3FF] p-0 text-white hover:bg-[#3D8FEE]"
                aria-label={attachImage ? "选择并发送图片" : "发送消息"}
                title={attachImage ? "选择并发送图片" : "发送消息"}
              >
                <span className="chat-composer-glyphs" aria-hidden="true">
                  <Send className="chat-send-icon h-4 w-4" />
                  {onSendImage && <Plus className="chat-attach-icon h-4 w-4" />}
                </span>
              </Button>
            </span>
          </div>
        </ChatContentSwitcher>
        {isDraggingImage && !alternateContentActive ? (
          <div className="chat-image-drop-hint">松开即可压缩发送</div>
        ) : null}
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
          onClosed={() => {
            setPreviewMessageId(null);
          }}
        />
      ) : null}
    </>
  );
};
