import { RoomReplayConsent } from "./room-replay-consent";
import type { ReplayControlMessage, ReplayStateMessage } from "./protocol";
import { isTemporaryRoomSessionId } from "../../shared/src/types/temporary-room.types";

export class RoomReplayController {
  readonly consent = new RoomReplayConsent();

  handle(
    roomId: string,
    peerId: string,
    members: readonly string[] | undefined,
    message: ReplayControlMessage,
    send: (peerId: string, response: ReplayStateMessage) => void,
  ): void {
    if (!members?.includes(peerId) || isTemporaryRoomSessionId(roomId)) {
      send(peerId, { type: "replay_state", roomId, error: "replay_unavailable" });
      return;
    }
    this.consent.sync(roomId, members);
    try {
      if (message.action === "start") this.consent.start(roomId, peerId, members);
      else if (message.action === "approve" || message.action === "revoke")
        this.consent.vote(
          roomId,
          peerId,
          message.sessionId!,
          message.epoch!,
          message.action === "approve",
        );
      else if (message.action === "stop") this.consent.stop(roomId, peerId, message.sessionId!);
      for (const target of members) {
        if (message.action === "read" && target !== peerId) continue;
        send(target, { type: "replay_state", roomId, state: this.consent.snapshot(roomId) });
      }
    } catch {
      send(peerId, {
        type: "replay_state",
        roomId,
        state: this.consent.snapshot(roomId),
        error: "replay_forbidden",
      });
    }
  }
}
