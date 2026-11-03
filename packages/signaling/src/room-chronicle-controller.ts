import type {
  ChronicleControlMessage,
  ChronicleAudioMessage,
  ChronicleStateMessage,
} from "./protocol";
import { RoomChronicleSessions } from "./room-chronicle-sessions";
import { isTemporaryRoomSessionId } from "../../shared/src/types/temporary-room.types";
import { RoomChronicleProcessor } from "./room-chronicle-processor";
import type { CloudAiRuntime } from "./cloud-ai-runtime";

/** Receives only the room and peer identity established by the signaling connection. */
export class RoomChronicleController {
  readonly sessions = new RoomChronicleSessions();
  private processor?: RoomChronicleProcessor;

  configure(
    runtime: Pick<CloudAiRuntime, "speechService" | "textService">,
    changed: (roomId: string) => void,
  ): void {
    this.processor = new RoomChronicleProcessor(
      this.sessions,
      runtime.speechService,
      runtime.textService,
      changed,
    );
  }

  sync(roomId: string, members: readonly string[]): void {
    if (this.sessions.updateMembers(roomId, members)) this.processor?.cancelRoom(roomId);
  }

  async audio(
    message: ChronicleAudioMessage,
    name: string,
    send: (response: ChronicleStateMessage) => void,
  ): Promise<void> {
    try {
      if (!this.processor) throw Error("chronicle_unavailable");
      await this.processor.submit(message, name);
      send({
        type: "chronicle_state",
        roomId: message.roomId,
        chunkId: message.chunkId,
        state: this.sessions.snapshot(message.roomId, message.peerId),
      });
    } catch (error) {
      let state;
      try {
        state = this.sessions.snapshot(message.roomId, message.peerId);
      } catch {
        return;
      }
      send({
        type: "chronicle_state",
        roomId: message.roomId,
        chunkId: message.chunkId,
        state,
        error:
          error instanceof Error && error.message === "chronicle_busy"
            ? "chronicle_busy"
            : "chronicle_unavailable",
      });
    }
  }

  dispose(): void {
    this.processor?.dispose();
  }

  handle(
    roomId: string,
    peerId: string,
    members: readonly string[] | undefined,
    message: ChronicleControlMessage,
    send: (targetPeerId: string, response: ChronicleStateMessage) => void,
  ): void {
    if (!members || isTemporaryRoomSessionId(roomId)) {
      send(peerId, { type: "chronicle_state", roomId, error: "chronicle_unavailable" });
      return;
    }
    this.sync(roomId, members);
    try {
      if (message.action === "start" && this.processor && !this.processor.configured()) {
        send(peerId, { type: "chronicle_state", roomId, error: "chronicle_unavailable" });
        return;
      }
      if (message.action === "start") {
        const id = this.sessions.start(roomId, peerId, members);
        this.sessions.participate(roomId, id, peerId, true);
      } else if (message.action === "participate")
        this.sessions.participate(roomId, message.sessionId!, peerId, message.enabled!);
      else if (message.action === "stop") this.sessions.stop(roomId, message.sessionId!, peerId);
      if (message.action === "stop" || (message.action === "participate" && !message.enabled))
        this.processor?.cancelRoom(roomId);
      for (const target of members) {
        if (message.action === "read" && target !== peerId) continue;
        send(target, {
          type: "chronicle_state",
          roomId,
          state: this.sessions.snapshot(roomId, target),
        });
      }
    } catch {
      send(peerId, { type: "chronicle_state", roomId, error: "chronicle_forbidden" });
    }
  }
}
