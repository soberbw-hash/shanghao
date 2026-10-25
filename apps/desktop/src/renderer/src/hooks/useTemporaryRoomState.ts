import { useEffect, useRef } from "react";
import { useRoomStore } from "../store/roomStore";
import { useAppStore } from "../store/appStore";

/** Subscribe only while the room page owns a temporary connection. */
export function useTemporaryRoomState(leaveRoom: () => Promise<void>) {
  const leave = useRef(leaveRoom);
  leave.current = leaveRoom;
  useEffect(
    () =>
      window.desktopApi.temporaryRooms?.onChanged((state) => {
        const store = useRoomStore.getState();
        const current = store.room.temporaryRoom;
        if (!current || current.contextId !== state.contextId) return;
        if (state.status === "ended") {
          void leave.current().catch(() => undefined);
          useAppStore.getState().pushToast({
            tone: "warning",
            title: "临时房间已结束",
            description: "重新创建或输入新的房间码即可加入。",
          });
        } else
          store.setRoom({
            temporaryRoom: {
              ...current,
              room: state.room ?? current.room,
              connectionWarning: state.error,
            },
          });
      }),
    [],
  );
}
