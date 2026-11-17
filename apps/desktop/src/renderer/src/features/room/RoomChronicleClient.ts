import type {
  ChronicleAudioMessage,
  ChronicleControlMessage,
  ChronicleStateMessage,
  SignalEnvelope,
} from "@private-voice/signaling";

export type ChronicleAudioPart = Omit<ChronicleAudioMessage, "type" | "roomId" | "peerId">;
const optedOutSessions = new Set<string>();

/** Additive protocol: never sends a new message to an older server. */
export class RoomChronicleClient {
  private supported = false;
  private disposed = false;
  private automaticSession?: string;
  private readonly pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private readonly roomId: string,
    private readonly peerId: string,
    private readonly send: (message: SignalEnvelope) => Promise<void>,
    private readonly changed?: (message: ChronicleStateMessage) => void,
  ) {}

  capability(supported: boolean): void {
    if (this.disposed) return;
    this.supported = supported;
    if (!supported) this.rejectPending("chronicle_unavailable");
    this.changed?.({ type: "chronicle_state", roomId: this.roomId, available: supported });
  }

  receive(message: ChronicleStateMessage): void {
    if (this.disposed || !this.supported || message.roomId !== this.roomId) return;
    const pending = message.chunkId && this.pending.get(message.chunkId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(message.chunkId!);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve();
    }
    this.changed?.({ ...message, available: this.supported });
  }

  async control(
    action: ChronicleControlMessage["action"],
    sessionId?: string,
    enabled?: boolean,
  ): Promise<void> {
    if (!this.supported) throw Error("chronicle_unavailable");
    if (action === "participate" && sessionId) {
      const key = `${this.roomId}:${sessionId}`;
      if (enabled) optedOutSessions.delete(key);
      else {
        optedOutSessions.add(key);
        if (optedOutSessions.size > 256)
          optedOutSessions.delete(optedOutSessions.values().next().value!);
      }
    }
    await this.send({
      type: "chronicle_control",
      roomId: this.roomId,
      peerId: this.peerId,
      action,
      sessionId,
      enabled,
    });
  }

  /** Join a new room session once; a member's stop choice wins for that session. */
  async joinAutomatically(sessionId: string): Promise<void> {
    if (this.automaticSession === sessionId || optedOutSessions.has(`${this.roomId}:${sessionId}`))
      return;
    this.automaticSession = sessionId;
    try {
      await this.control("participate", sessionId, true);
    } catch (error) {
      this.automaticSession = undefined;
      throw error;
    }
  }

  async audio(part: ChronicleAudioPart): Promise<void> {
    if (!this.supported || this.pending.size >= 1) throw Error("chronicle_busy");
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(part.chunkId);
        reject(new Error("chronicle_timeout"));
      }, 65_000);
      this.pending.set(part.chunkId, { resolve, reject, timer });
      const fail = (error: unknown) => {
        if (this.pending.get(part.chunkId)?.timer !== timer) return;
        clearTimeout(timer);
        this.pending.delete(part.chunkId);
        reject(error);
      };
      try {
        void this.send({
          ...part,
          type: "chronicle_audio",
          roomId: this.roomId,
          peerId: this.peerId,
        }).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.supported = false;
    this.rejectPending("chronicle_closed");
  }

  private rejectPending(reason: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
