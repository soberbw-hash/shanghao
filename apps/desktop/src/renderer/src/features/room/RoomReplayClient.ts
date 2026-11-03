import type {
  ReplayControlMessage,
  ReplayStateMessage,
  SignalEnvelope,
} from "@private-voice/signaling";

/** No audio travels over this transport; it only synchronizes explicit room consent. */
export class RoomReplayClient {
  private supported = false;
  private disposed = false;
  constructor(
    private readonly roomId: string,
    private readonly peerId: string,
    private readonly send: (message: SignalEnvelope) => Promise<void>,
    private readonly changed?: (message: ReplayStateMessage) => void,
  ) {}
  capability(supported: boolean): void {
    if (this.disposed) return;
    this.supported = supported;
    this.changed?.({ type: "replay_state", roomId: this.roomId, available: supported });
  }
  receive(message: ReplayStateMessage): void {
    if (this.supported && message.roomId === this.roomId)
      this.changed?.({ ...message, available: true });
  }
  async control(
    action: ReplayControlMessage["action"],
    state?: { sessionId: string; epoch: number },
  ): Promise<void> {
    if (!this.supported) throw Error("replay_unavailable");
    await this.send({
      type: "replay_control",
      roomId: this.roomId,
      peerId: this.peerId,
      action,
      ...state,
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.supported = false;
    this.changed?.({ type: "replay_state", roomId: this.roomId, available: false });
  }
}
