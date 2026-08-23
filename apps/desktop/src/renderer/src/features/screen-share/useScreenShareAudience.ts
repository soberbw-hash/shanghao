import { useEffect, useMemo, useRef, useState } from "react";

import type { RoomMember } from "@private-voice/shared";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";

export const SCREEN_SHARE_NO_VIEWER_TIMEOUT_SECONDS = 60;

interface UseScreenShareAudienceOptions {
  members: RoomMember[];
  localStream?: MediaStream;
  detachedViewerId?: string;
  setViewingActive: (active: boolean) => void;
  stopShare: (reason?: string) => Promise<void>;
}

/** Keeps viewer presence, bandwidth idling and its concise UI feedback out of RoomPage. */
export const useScreenShareAudience = ({
  members,
  localStream,
  detachedViewerId,
  setViewingActive,
  stopShare,
}: UseScreenShareAudienceOptions) => {
  const currentPage = useAppStore((state) => state.currentPage);
  const pushToast = useAppStore((state) => state.pushToast);
  const viewerPeerIds = useRoomStore((state) => state.localScreenShareViewerPeerIds);
  const [autoStopRemainingSeconds, setAutoStopRemainingSeconds] = useState<number>();
  const previousViewerIdsRef = useRef<string[]>([]);
  const autoStopTriggeredRef = useRef(false);
  const viewerNames = useMemo(
    () =>
      viewerPeerIds.map(
        (peerId) => members.find((member) => member.id === peerId)?.nickname?.trim() || "好友",
      ),
    [members, viewerPeerIds],
  );

  useEffect(() => {
    const syncViewingState = () =>
      setViewingActive(
        Boolean(detachedViewerId) ||
          (currentPage === "room" && document.visibilityState === "visible"),
      );
    syncViewingState();
    document.addEventListener("visibilitychange", syncViewingState);
    return () => {
      document.removeEventListener("visibilitychange", syncViewingState);
      setViewingActive(false);
    };
  }, [currentPage, detachedViewerId, setViewingActive]);

  useEffect(() => {
    const previous = previousViewerIdsRef.current;
    if (!localStream) {
      previousViewerIdsRef.current = [];
      return;
    }
    const joined = viewerPeerIds.filter((peerId) => !previous.includes(peerId));
    if (joined.length > 0) {
      const names = joined.map(
        (peerId) => members.find((member) => member.id === peerId)?.nickname || "好友",
      );
      pushToast({
        tone: "neutral",
        title: `${names.join("、")}正在观看你的屏幕`,
        description: `当前共 ${viewerPeerIds.length} 人正在观看。`,
      });
    } else if (previous.length > 0 && viewerPeerIds.length === 0) {
      pushToast({
        tone: "warning",
        title: "现在没有人在观看",
        description: `${SCREEN_SHARE_NO_VIEWER_TIMEOUT_SECONDS} 秒内仍无人观看将自动停止分享。`,
      });
    }
    previousViewerIdsRef.current = viewerPeerIds;
  }, [localStream, members, pushToast, viewerPeerIds]);

  useEffect(() => {
    if (!localStream || viewerPeerIds.length > 0) {
      autoStopTriggeredRef.current = false;
      setAutoStopRemainingSeconds(undefined);
      return;
    }
    const deadline = Date.now() + SCREEN_SHARE_NO_VIEWER_TIMEOUT_SECONDS * 1_000;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setAutoStopRemainingSeconds(remaining);
      if (remaining > 0 || autoStopTriggeredRef.current) return;
      autoStopTriggeredRef.current = true;
      void stopShare("no-viewers")
        .then(() => {
          pushToast({
            tone: "neutral",
            title: "屏幕分享已自动停止",
            description: "持续一分钟无人观看，已经停止占用上传带宽。",
          });
        })
        .catch(() => {
          pushToast({
            tone: "warning",
            title: "自动停止没有完成",
            description: "请点击屏幕分享窗口中的“停止”释放上传带宽。",
          });
        });
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [localStream, pushToast, stopShare, viewerPeerIds.length]);

  return { viewerNames, autoStopRemainingSeconds };
};
