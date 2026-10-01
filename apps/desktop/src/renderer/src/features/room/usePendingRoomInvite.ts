import { useEffect, useRef } from "react";
import type { PrivateRoomInfo } from "@private-voice/shared";
import { shanghaoCore } from "../../core/shanghaoCore";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";

/** Resolve by immutable ID; the displayed code never redirects to a recycled room. */
export const usePendingRoomInvite = (options: {
  roomId?: string;
  autoJoin: boolean;
  userId?: string;
  serverUrl?: string;
  joining: boolean;
  generation: { current: number };
  onFound: (room: PrivateRoomInfo) => void;
  onBusy: (busy: boolean) => void;
  onError: (error: unknown) => void;
  onJoin: (room: PrivateRoomInfo) => Promise<void>;
}): void => {
  const latest = useRef(options);
  latest.current = options;
  const { roomId, autoJoin, userId, serverUrl, joining } = options;
  useEffect(() => {
    if (!roomId || !userId || joining) return;
    let cancelled = false;
    let claimed = false;
    const owner = latest.current.generation.current;
    const current = () => latest.current.generation.current === owner;
    const clearPending = () => {
      if (useAppStore.getState().pendingRoomInvite === roomId)
        useAppStore.getState().setPendingRoomInvite(undefined);
    };
    void shanghaoCore.rooms
      .get(roomId)
      .then(async (room) => {
        if (cancelled || !current()) return;
        latest.current.onFound(room);
        claimed = true;
        clearPending();
        if (
          !autoJoin ||
          (useRoomStore.getState().room.roomId === room.roomId &&
            useAppStore.getState().currentPage === "room")
        )
          return;
        if (room.onlineCount >= room.capacity) throw new Error("room_full");
        latest.current.onBusy(true);
        try {
          await latest.current.onJoin(room);
        } finally {
          if (current()) latest.current.onBusy(false);
        }
      })
      .catch((error) => {
        if (current() && !cancelled) latest.current.onError(error);
        // A claimed join may outlive its pending marker being cleared.
        else if (claimed && current() && useAppStore.getState().pendingRoomInvite === undefined)
          latest.current.onError(error);
      })
      .finally(() => {
        if (!cancelled && current()) clearPending();
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, autoJoin, userId, serverUrl, joining]);
};
