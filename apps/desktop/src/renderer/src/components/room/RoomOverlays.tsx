import { useMemo } from "react";
import { Copy, ExternalLink, FolderHeart, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { RoomCollectionItem, ScreenCaptureSourceDescriptor } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import donateQr from "../../assets/donate-qr.jpg";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { Button } from "../base/Button";

interface ScreenSourcePickerProps {
  isOpen: boolean;
  reduceMotion: boolean;
  sources: ScreenCaptureSourceDescriptor[];
  includeSystemAudio: boolean;
  onIncludeSystemAudioChange: (value: boolean) => void;
  onSelect: (sourceId: string) => void;
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
}: ScreenSourcePickerProps) => (
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
          variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
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
              <p>固定使用 1440p 清晰画质。显示器已编号，窗口会显示应用名称。</p>
            </div>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
          </header>
          <div className="screen-source-options">
            <span className="screen-source-quality-badge">1440p · 清晰</span>
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
            {sources.map((source, index) => (
              <button
                key={source.id}
                type="button"
                className="screen-source-picker-item"
                onClick={() => onSelect(source.id)}
              >
                <span className="screen-source-thumbnail">
                  <strong className="screen-source-identity">
                    {source.displayLabel ??
                      (source.kind === "screen" ? `显示器 ${index + 1}` : "窗口")}
                  </strong>
                  {source.thumbnailDataUrl ? (
                    <img src={source.thumbnailDataUrl} alt="" draggable={false} />
                  ) : (
                    <span className="screen-source-thumbnail-fallback">暂无预览</span>
                  )}
                </span>
                <span className="screen-source-name">
                  {source.appIconDataUrl ? <img src={source.appIconDataUrl} alt="" /> : null}
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
            variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
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
            <div className="collection-list">
              {orderedItems.length ? (
                orderedItems.map((item) => (
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
