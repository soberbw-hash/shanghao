import type { ReplayStateMessage } from "@private-voice/signaling";
import type { RoomChronicleViewState } from "./RoomChronicleClient";
import { useRoomStore } from "../../store/roomStore";

export function roomLiveStateCallbacks(isCurrentSession: () => boolean) {
  return {
    onChronicleState: (message: RoomChronicleViewState) => {
      if (isCurrentSession()) useRoomStore.getState().setChronicle(message);
    },
    onReplayState: (message: ReplayStateMessage) => {
      if (isCurrentSession()) useRoomStore.getState().setReplay(message);
    },
  };
}
