import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FolderHeart, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { RoomCollectionItem } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import {
  largeDialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { Button } from "../base/Button";
export { ScreenSourcePicker } from "./ScreenSourcePicker";

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
