import { useRoomState } from "../../hooks/useRoomState";
import { TemporaryRoomEntry } from "./TemporaryRoomEntry";
export function TemporaryGuestEntry() {
  const { joinChannel } = useRoomState();
  return (
    <TemporaryRoomEntry onJoin={(room) => joinChannel(room.signalingUrl, room.roomId, room)} />
  );
}
