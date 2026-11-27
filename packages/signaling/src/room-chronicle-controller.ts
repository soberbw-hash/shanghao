import type {
  ChronicleControlMessage,
  ChronicleAudioMessage,
  ChronicleStateMessage,
  ChronicleHistoryMessage,
} from "./protocol";
import type { WebSocket } from "ws";
import { getRoomChronicleDate } from "@private-voice/shared";
import type { RoomManager } from "./room-manager";
import { RoomChronicleSessions, type ChronicleEntry } from "./room-chronicle-sessions";
import { isTemporaryRoomSessionId } from "../../shared/src/types/temporary-room.types";
import { RoomChronicleProcessor } from "./room-chronicle-processor";
import { selectChronicleGameHint } from "./room-chronicle-game-hint";
import type { CloudAiRuntime } from "./cloud-ai-runtime";
import { shiftShanghaiDate, type DailyRoomReportStore } from "./daily-room-report-store";

/** Receives only the room and peer identity established by the signaling connection. */
export class RoomChronicleController {
  readonly sessions = new RoomChronicleSessions();
  private processor?: RoomChronicleProcessor;
  private chronicleRolloverTimer?: NodeJS.Timeout;
  private history?: {
    rooms: RoomManager;
    store: DailyRoomReportStore;
    send: (socket: WebSocket, message: ChronicleHistoryMessage | ChronicleStateMessage) => boolean;
  };

  configure(
    runtime: Pick<CloudAiRuntime, "speechService" | "textService">,
    changed: (roomId: string) => void,
    reports?: Promise<DailyRoomReportStore>,
    speakerNames?: (roomId: string) => Promise<Map<string, string>>,
  ): void {
    this.processor = new RoomChronicleProcessor(
      this.sessions,
      runtime.speechService,
      runtime.textService,
      (roomId, entries) => {
        changed(roomId);
        if (entries?.length) this.broadcastChronicleEntries(roomId, entries);
      },
      undefined,
      reports,
      speakerNames,
      ({ roomId, peerId, gameContext }) => {
        const peers = this.history?.rooms.getRoom(roomId)?.peers;
        return selectChronicleGameHint(
          peers?.getPeer(peerId),
          peers?.listConnectedPeers() ?? [],
          gameContext,
        );
      },
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
          error instanceof Error && error.message === "cloud_asr_http_402"
            ? "chronicle_speech_quota"
            : error instanceof Error && error.message === "chronicle_busy"
              ? "chronicle_busy"
              : "chronicle_unavailable",
      });
    }
  }

  dispose(): void {
    clearTimeout(this.chronicleRolloverTimer);
    this.processor?.dispose();
  }

  async startHistory(
    rooms: RoomManager,
    reports: Promise<DailyRoomReportStore>,
    send: NonNullable<RoomChronicleController["history"]>["send"],
  ): Promise<void> {
    const store = await reports;
    this.history = { rooms, store, send };
    store.compactChronicleHistory();
    this.scheduleChronicleRollover();
  }

  day(): string | undefined {
    return this.history ? getRoomChronicleDate() : undefined;
  }

  sendHistory(socket: WebSocket, roomId: string, now = Date.now()): void {
    const history = this.history;
    if (!history) return;
    const day = history.store.getChronicleDay(roomId, now);
    // Keep even large rooms' whole day within the existing per-message size limit.
    for (let offset = 0; offset < Math.max(1, day.entries.length); offset += 32) {
      if (
        !history.send(socket, {
          type: "chronicle_history",
          roomId,
          date: day.date,
          entries: day.entries.slice(offset, offset + 32),
          replace: offset === 0 ? true : undefined,
        })
      )
        break;
    }
  }

  private broadcastChronicleEntries(roomId: string, stories: ChronicleEntry[]): void {
    const history = this.history;
    if (!history || isTemporaryRoomSessionId(roomId)) return;
    const date = getRoomChronicleDate();
    const entries = stories.filter((entry) => getRoomChronicleDate(entry.at) === date);
    if (!entries.length) return;
    for (const peer of history.rooms.getRoom(roomId)?.peers.listConnectedPeers() ?? [])
      history.send(peer.socket, { type: "chronicle_history", roomId, date, entries });
  }

  private scheduleChronicleRollover(): void {
    const history = this.history;
    if (!history) return;
    const now = Date.now();
    const next = Date.parse(`${shiftShanghaiDate(getRoomChronicleDate(now), 1)}T00:00:00+08:00`);
    this.chronicleRolloverTimer = setTimeout(
      () => {
        const cutoff = Date.now();
        this.sessions.clearExpiredEntries(getRoomChronicleDate(cutoff));
        history.store.compactChronicleHistory(cutoff);
        for (const room of history.rooms.listRooms()) {
          if (isTemporaryRoomSessionId(room.roomId)) continue;
          for (const peer of room.peers.listConnectedPeers()) {
            this.sendHistory(peer.socket, room.roomId, cutoff);
            const state = this.sessions.snapshot(room.roomId, peer.id);
            if (state)
              history.send(peer.socket, { type: "chronicle_state", roomId: room.roomId, state });
          }
        }
        this.scheduleChronicleRollover();
      },
      Math.max(1, next - now),
    );
    this.chronicleRolloverTimer.unref();
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
