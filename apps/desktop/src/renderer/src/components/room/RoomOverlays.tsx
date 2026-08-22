import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FolderHeart, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { RoomCollectionItem, ScreenCaptureSourceDescriptor } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import donateQr from "../../assets/donate-qr.jpg";
import {
  dialogSurfaceVariants,
  largeDialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { Button } from "../base/Button";
import {
  DEFAULT_SCREEN_SHARE_QUALITY,
  type ScreenShareQuality,
} from "../../features/screen-share/types";

interface ScreenSourcePickerProps {
  isOpen: boolean;
  reduceMotion: boolean;
  sources: ScreenCaptureSourceDescriptor[];
  includeSystemAudio: boolean;
  onIncludeSystemAudioChange: (value: boolean) => void;
  onSelect: (sourceId: string, quality: ScreenShareQuality) => void;
  onClose: () => void;
}

export const ScreenSourcePicker = ({
  isOpen,
  reduceMotion,
  sources,
  includeSystemAudio,
  onIncludeSystemAudioChange,
  onSelect,
  onClose,
}: ScreenSourcePickerProps) => {
  const [quality, setQuality] = useState<ScreenShareQuality>(DEFAULT_SCREEN_SHARE_QUALITY);

  useEffect(() => {
    if (isOpen) setQuality(DEFAULT_SCREEN_SHARE_QUALITY);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="screen-source-picker"
          className="screen-source-picker-backdrop"
          variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            className="screen-source-picker-panel modal-surface"
            variants={reduceMotion ? reducedFadeVariants : largeDialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="dialog"
            aria-modal="true"
            aria-label="选择要分享的画面"
          >
            <header>
              <div>
                <h2>分享哪个画面？</h2>
                <p>默认 1080p，也可以选择更省带宽的 720p。实际清晰度取决于来源窗口大小。</p>
              </div>
              <Button variant="ghost" onClick={onClose}>
                取消
              </Button>
            </header>
            <div className="screen-source-options">
              <div className="screen-source-quality" aria-label="分享清晰度">
                <span>清晰度</span>
                {(["1080p", "720p"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={quality === value ? "active" : ""}
                    aria-pressed={quality === value}
                    onClick={() => setQuality(value)}
                  >
                    {value}
                    <small>{value === "1080p" ? "默认" : "省带宽"}</small>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={`screen-audio-toggle ${includeSystemAudio ? "active" : ""}`}
                aria-pressed={includeSystemAudio}
                onClick={() => onIncludeSystemAudioChange(!includeSystemAudio)}
              >
                <span aria-hidden="true">{includeSystemAudio ? "✓" : ""}</span>
                系统音频
              </button>
            </div>
            <div className="screen-source-picker-grid">
              {sources.length === 0 ? (
                <div className="screen-source-picker-loading" role="status">
                  <span aria-hidden="true" />
                  <strong>正在读取可分享的窗口…</strong>
                  <small>通常只需要片刻</small>
                </div>
              ) : null}
              {sources.slice(0, 24).map((source, index) => (
                <button
                  key={source.id}
                  type="button"
                  className="screen-source-picker-item"
                  onClick={() => onSelect(source.id, quality)}
                >
                  <span className="screen-source-thumbnail">
                    <strong className="screen-source-identity">
                      {source.displayLabel ??
                        (source.kind === "screen" ? `显示器 ${index + 1}` : "窗口")}
                    </strong>
                    {source.thumbnailDataUrl ? (
                      <img
                        src={source.thumbnailDataUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                        draggable={false}
                      />
                    ) : (
                      <span
                        className={`screen-source-thumbnail-fallback ${source.kind}`}
                        aria-hidden="true"
                      >
                        <span />
                        <small>{source.kind === "screen" ? "整个显示器" : "应用窗口"}</small>
                      </span>
                    )}
                  </span>
                  <span className="screen-source-name">
                    {source.appIconDataUrl ? (
                      <img
                        src={source.appIconDataUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        fetchPriority="low"
                      />
                    ) : null}
                    <span>{source.name}</span>
                    <small>{source.kind === "screen" ? "显示器" : "窗口"}</small>
                  </span>
                </button>
              ))}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

interface DonationDialogProps {
  isOpen: boolean;
  reduceMotion: boolean;
  onClose: () => void;
}

export const DonationDialog = ({ isOpen, reduceMotion, onClose }: DonationDialogProps) => (
  <AnimatePresence>
    {isOpen ? (
      <motion.div
        className="donation-modal-backdrop modal-scrim"
        role="presentation"
        variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
        initial="initial"
        animate="open"
        exit="closed"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <motion.section
          className="donation-modal-panel modal-surface"
          role="dialog"
          aria-modal="true"
          aria-labelledby="donation-modal-title"
          variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
          initial="initial"
          animate="open"
          exit="closed"
        >
          <h2 id="donation-modal-title">请作者喝杯咖啡</h2>
          <p>如果上号让你和朋友多开了一局，就请我补充一点续航。</p>
          <div className="donation-qr-shell">
            <img src={donateQr} alt="请作者喝咖啡的收款二维码" draggable={false} />
          </div>
          <div className="donation-modal-actions">
            <span>微信扫码，心意随缘</span>
            <Button variant="secondary" onClick={onClose}>
              收下啦
            </Button>
          </div>
        </motion.section>
      </motion.div>
    ) : null}
  </AnimatePresence>
);

interface CollectionDialogProps {
  isOpen: boolean;
  reduceMotion: boolean;
  draft: string;
  isSaving: boolean;
  items: RoomCollectionItem[];
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onOpenItem: (content: string) => void;
  onCopyItem: (content: string, kind: RoomCollectionItem["kind"]) => void;
  onRemoveItem: (itemId: string) => void;
  onClose: () => void;
}

const COLLECTION_RENDER_BATCH_SIZE = 24;

export const CollectionDialog = ({
  isOpen,
  reduceMotion,
  draft,
  isSaving,
  items,
  onDraftChange,
  onSave,
  onOpenItem,
  onCopyItem,
  onRemoveItem,
  onClose,
}: CollectionDialogProps) => {
  const orderedItems = useMemo(() => [...items].reverse(), [items]);
  const [visibleItemCount, setVisibleItemCount] = useState(COLLECTION_RENDER_BATCH_SIZE);
  const visibleItems = orderedItems.slice(0, visibleItemCount);

  useEffect(() => {
    if (isOpen) setVisibleItemCount(COLLECTION_RENDER_BATCH_SIZE);
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="room-collection"
          className="collection-modal-backdrop modal-scrim"
          role="presentation"
          variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            className="collection-modal-panel modal-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="collection-modal-title"
            variants={reduceMotion ? reducedFadeVariants : largeDialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
          >
            <header className="collection-modal-header">
              <h2 id="collection-modal-title">收藏</h2>
              <Button variant="ghost" onClick={onClose}>
                收起
              </Button>
            </header>
            <div className="collection-composer">
              <textarea
                value={draft}
                maxLength={2_000}
                placeholder="输入一句话或粘贴链接…"
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault();
                    onSave();
                  }
                }}
              />
              <Button variant="primary" disabled={!draft.trim() || isSaving} onClick={onSave}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {isSaving ? "保存中" : "添加收藏"}
              </Button>
            </div>
            <div
              className="collection-list"
              onScroll={(event) => {
                const list = event.currentTarget;
                if (list.scrollHeight - list.scrollTop - list.clientHeight > 240) return;
                setVisibleItemCount((current) =>
                  Math.min(orderedItems.length, current + COLLECTION_RENDER_BATCH_SIZE),
                );
              }}
            >
              {orderedItems.length ? (
                visibleItems.map((item) => (
                  <article
                    key={item.id}
                    className={cn("collection-item", item.kind === "image" && "is-image")}
                  >
                    <div className="collection-item-copy">
                      <span>
                        {item.kind === "text"
                          ? "便笺"
                          : item.kind === "game"
                            ? "游戏"
                            : item.kind === "image"
                              ? "图片"
                              : "链接"}
                      </span>
                      <strong>{item.title}</strong>
                      {item.kind === "image" ? (
                        <img
                          className="collection-item-image"
                          src={item.content}
                          alt={item.title}
                          loading="lazy"
                          decoding="async"
                          fetchPriority="low"
                          draggable={false}
                        />
                      ) : (
                        <p>{item.content}</p>
                      )}
                      <small>由 {item.createdByNickname} 留下</small>
                    </div>
                    <div className="collection-item-actions">
                      {item.kind === "link" ? (
                        <button
                          type="button"
                          title="在浏览器中打开"
                          aria-label={`打开 ${item.title}`}
                          onClick={() => onOpenItem(item.content)}
                        >
                          <ExternalLink aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        title="复制"
                        aria-label={`复制 ${item.title}`}
                        onClick={() => onCopyItem(item.content, item.kind)}
                      >
                        <Copy aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        aria-label={`删除 ${item.title}`}
                        onClick={() => onRemoveItem(item.id)}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="collection-empty">
                  <FolderHeart aria-hidden="true" />
                  <strong>还没有收藏</strong>
                  <span>在上方添加第一条</span>
                </div>
              )}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
