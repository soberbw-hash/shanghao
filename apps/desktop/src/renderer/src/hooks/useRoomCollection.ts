import { useEffect, useRef, useState } from "react";

import type { RoomCollectionItemKind } from "@private-voice/shared";

import { playUiSound } from "../features/audio/uiSound";
import type { RoomCollectionDragPayload } from "../features/chat/collectionDrag";
import { useAppStore } from "../store/appStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

interface UseRoomCollectionOptions {
  localMemberId?: string;
  addItem: (kind: RoomCollectionItemKind, title: string, content: string) => Promise<void>;
}

export const useRoomCollection = ({ localMemberId, addItem }: UseRoomCollectionOptions) => {
  const pushToast = useAppStore((state) => state.pushToast);
  const items = useRoomStore((state) => state.collectionItems);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const initializedRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const lastViewedAt = settings?.lastCollectionViewedAt
    ? Date.parse(settings.lastCollectionViewedAt)
    : 0;
  const hasUnreadItems = Boolean(
    settings?.hasInitializedCollectionReadState &&
    items.some(
      (item) => item.createdByPeerId !== localMemberId && Date.parse(item.createdAt) > lastViewedAt,
    ),
  );

  useEffect(() => {
    if (!settings || settings.hasInitializedCollectionReadState || initializedRef.current) {
      return;
    }
    initializedRef.current = true;
    const newestCreatedAt = items.reduce(
      (latest, item) => Math.max(latest, Date.parse(item.createdAt) || 0),
      Date.now(),
    );
    void saveSettings({
      hasInitializedCollectionReadState: true,
      lastCollectionViewedAt: new Date(newestCreatedAt).toISOString(),
    });
  }, [items, saveSettings, settings]);

  const open = () => {
    playUiSound("popup-open");
    setIsOpen(true);
    if (!settings) return;
    void saveSettings({
      hasInitializedCollectionReadState: true,
      lastCollectionViewedAt: new Date().toISOString(),
    });
  };

  const openItem = async (content: string) => {
    try {
      const url = new URL(content);
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      await window.desktopApi.app.openExternal(url.toString());
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "链接无法打开",
        description: "这个链接格式不正确，已阻止打开。",
      });
      await window.desktopApi.app.writeLog({
        category: "app",
        level: "warn",
        message: "collection_external_link_rejected",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  const saveDraft = async () => {
    const content = draft.trim();
    if (!content || isSaving) return;
    let parsedUrl: URL | undefined;
    try {
      const candidate = new URL(content);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") {
        parsedUrl = candidate;
      }
    } catch {
      parsedUrl = undefined;
    }
    const normalizedPath = parsedUrl?.pathname.toLocaleLowerCase() ?? "";
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((extension) =>
      normalizedPath.endsWith(extension),
    );
    const kind: RoomCollectionItemKind = isImage ? "image" : parsedUrl ? "link" : "text";
    const title = parsedUrl
      ? parsedUrl.hostname.replace(/^www\./, "") || "频道链接"
      : content.slice(0, 36);

    setIsSaving(true);
    try {
      await addItem(kind, title, content);
      setDraft("");
      playUiSound("send-message");
    } catch {
      pushToast({ tone: "danger", title: "收藏失败", description: "连接还没有恢复，请稍后再试。" });
    } finally {
      setIsSaving(false);
    }
  };

  const saveDragged = async (payload: RoomCollectionDragPayload) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await addItem(payload.kind, payload.title, payload.content);
      playUiSound("send-message");
      pushToast({
        tone: "success",
        title: "已放入收藏",
        description: payload.kind === "image" ? "这张图片会一直保留。" : payload.title,
      });
    } catch {
      pushToast({
        tone: "danger",
        title: "收藏失败",
        description: "连接还没有恢复，请稍后再拖一次。",
      });
    } finally {
      setIsSaving(false);
      setIsDragOver(false);
    }
  };

  const copyItem = async (content: string, kind: RoomCollectionItemKind = "text") => {
    try {
      if (kind === "image") await window.desktopApi.clipboard.writeImage(content);
      else await window.desktopApi.clipboard.writeText(content);
      playUiSound("button-click");
      pushToast({
        tone: "success",
        title: kind === "image" ? "已复制图片" : "已复制",
        description: "收藏内容已放进剪贴板。",
      });
    } catch {
      pushToast({ tone: "danger", title: "复制失败", description: "请稍后再试。" });
    }
  };

  return {
    items,
    draft,
    setDraft,
    isOpen,
    setIsOpen,
    isDragOver,
    setIsDragOver,
    isSaving,
    hasUnreadItems,
    open,
    openItem,
    saveDraft,
    saveDragged,
    copyItem,
  };
};
