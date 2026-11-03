import type { ChronicleStateMessage, ReplayStateMessage } from "@private-voice/signaling";
import { useRoomStore } from "../../store/roomStore";

export function roomLiveStateCallbacks(isCurrentSession: () => boolean) {
  return {
    onChronicleState: (message: ChronicleStateMessage) => {
      if (isCurrentSession()) useRoomStore.getState().setChronicle(message);
    },
    onReplayState: (message: ReplayStateMessage) => {
      if (isCurrentSession()) useRoomStore.getState().setReplay(message);
    },
  };
}
