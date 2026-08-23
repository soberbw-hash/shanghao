import { useEffect, useMemo, useRef, useState } from "react";

import { selectScreenShareView } from "../../features/room/roomViewModel";
import type {
  ScreenShareItem,
  ScreenShareQuality,
  ScreenShareTransitionOrigin,
} from "../../features/screen-share/types";
import { useRoomStore } from "../../store/roomStore";
import { ScreenSharePanel } from "./ScreenSharePanel";

/**
 * Keeps relay-frame freshness and screen-share rendering out of RoomPage.
 * Relay frames may arrive several times per second; only this small subtree
 * needs to reconcile them and the one-second stale-frame clock.
 */
export const ScreenSharePanelContainer = ({
  localStream,
  localQuality,
  transitionOrigin,
  localViewerNames,
  autoStopRemainingSeconds,
  detachedItemId,
  onStopLocalShare,
  onOpenDetached,
  syncDetachedItem,
}: {
  localStream?: MediaStream;
  localQuality?: ScreenShareQuality;
  transitionOrigin?: ScreenShareTransitionOrigin;
  localViewerNames: string[];
  autoStopRemainingSeconds?: number;
  detachedItemId?: string;
  onStopLocalShare: () => void;
  onOpenDetached: (item: ScreenShareItem) => Promise<void>;
  syncDetachedItem: (item?: ScreenShareItem) => Promise<void>;
}) => {
  const members = useRoomStore((state) => state.room.members);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const remoteScreenFrames = useRoomStore((state) => state.remoteScreenFrames);
  const remoteScreenSharing = useRoomStore((state) => state.remoteScreenSharing);
  const [now, setNow] = useState(() => Date.now());
  const pendingDetachedItemRef = useRef<ScreenShareItem | undefined>(undefined);
  const lastSyncedDetachedItemRef = useRef<ScreenShareItem | undefined>(undefined);
  const detachedSyncTimerRef = useRef<number | undefined>(undefined);
  const syncDetachedItemRef = useRef(syncDetachedItem);
  syncDetachedItemRef.current = syncDetachedItem;
  const hasRelayFrames = Object.keys(remoteScreenFrames).length > 0;

  useEffect(() => {
    if (!hasRelayFrames) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasRelayFrames]);

  const screenShareView = useMemo(
    () =>
      selectScreenShareView({
        members,
        localStream,
        localQuality,
        remoteStreams,
        remoteFrames: remoteScreenFrames,
        remoteSharing: remoteScreenSharing,
        now,
      }),
    [
      localQuality,
      members,
      localStream,
      now,
      remoteStreams,
      remoteScreenFrames,
      remoteScreenSharing,
    ],
  );

  const detachedItem = useMemo(
    () =>
      detachedItemId ? screenShareView.items.find((item) => item.id === detachedItemId) : undefined,
    [detachedItemId, screenShareView.items],
  );

  useEffect(() => {
    const previous = lastSyncedDetachedItemRef.current;
    const changed =
      previous?.id !== detachedItem?.id ||
      previous?.frameDataUrl !== detachedItem?.frameDataUrl ||
      Boolean(previous?.stream) !== Boolean(detachedItem?.stream);
    pendingDetachedItemRef.current = detachedItem;
    if (!changed) {
      if (detachedSyncTimerRef.current !== undefined) {
        window.clearTimeout(detachedSyncTimerRef.current);
        detachedSyncTimerRef.current = undefined;
      }
      pendingDetachedItemRef.current = undefined;
      return;
    }
    if (detachedSyncTimerRef.current !== undefined) return;
    detachedSyncTimerRef.current = window.setTimeout(() => {
      detachedSyncTimerRef.current = undefined;
      const latest = pendingDetachedItemRef.current;
      pendingDetachedItemRef.current = undefined;
      lastSyncedDetachedItemRef.current = latest;
      void syncDetachedItemRef.current(latest);
    }, 200);
  }, [detachedItem]);

  useEffect(
    () => () => {
      if (detachedSyncTimerRef.current !== undefined) {
        window.clearTimeout(detachedSyncTimerRef.current);
      }
    },
    [],
  );

  return (
    <ScreenSharePanel
      items={screenShareView.items}
      localViewerNames={localViewerNames}
      autoStopRemainingSeconds={autoStopRemainingSeconds}
      transitionOrigin={transitionOrigin}
      onStopLocalShare={onStopLocalShare}
      onOpenDetached={onOpenDetached}
    />
  );
};
