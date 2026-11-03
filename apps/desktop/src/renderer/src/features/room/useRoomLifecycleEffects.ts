import { useEffect, type Dispatch, type SetStateAction } from "react";
import { phoneMicSource } from "../audio/phoneMicSource";

export function useRoomLifecycleEffects(
  pendingInvite: unknown,
  setRoomPickerOpen: Dispatch<SetStateAction<boolean>>,
  leaveRoom: () => Promise<unknown>,
) {
  useEffect(() => {
    if (pendingInvite) setRoomPickerOpen(true);
  }, [pendingInvite, setRoomPickerOpen]);
  useEffect(() => {
    const leaveReconnectingRoom = () => void leaveRoom().catch(() => undefined);
    window.addEventListener("shanghao:leave-reconnecting-room", leaveReconnectingRoom);
    return () =>
      window.removeEventListener("shanghao:leave-reconnecting-room", leaveReconnectingRoom);
  }, [leaveRoom]);
  useEffect(
    () => () => {
      void phoneMicSource.stop();
    },
    [],
  );
}
