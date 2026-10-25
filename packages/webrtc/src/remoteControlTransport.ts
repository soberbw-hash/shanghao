import type {
  RemoteControlInputEnvelope,
  RemoteControlLane,
} from "@private-voice/shared/types/remote-control.types";
import { validRemoteControlMessage, type RemoteControlMessage } from "./remoteControlProtocol";
export type { RemoteControlMessage } from "./remoteControlProtocol";

export interface RemoteControlCapability {
  available: boolean;
  reason?: string;
}
export type RemoteControlSendResult = { ok: true } | { ok: false; reason: string };
export interface RemoteControlTransportOptions {
  onMessage: (
    authenticatedPeerId: string,
    message: RemoteControlMessage,
    lane: RemoteControlLane,
  ) => void;
  onCapabilityChange?: (authenticatedPeerId: string, capability: RemoteControlCapability) => void;
}
const labels = {
  reliable: "shanghao.remote-control.v1",
  pointer: "shanghao.remote-pointer.v1",
} as const;
const MAX_BYTES = 4096;
const encoder = new TextEncoder();
interface BoundChannel {
  channel: RTCDataChannel;
  detach: () => void;
}
interface Rate {
  at: number;
  count: number;
}

/** Data only, on the existing authenticated PeerConnection. No signaling fallback. */
export class RemoteControlTransport {
  private lanes: Partial<Record<RemoteControlLane, BoundChannel>> = {};
  private hello = false;
  private ack = false;
  private destroyed = false;
  private failureReason?: string;
  private lastCapability = "";
  private readonly rates = new Map<string, Rate>();
  private readonly stateChanged = () => this.publishCapability();
  private readonly dataChannel = (event: RTCDataChannelEvent) => this.bindIncoming(event.channel);

  constructor(
    private readonly connection: RTCPeerConnection,
    private readonly peerId: string,
    private readonly options: RemoteControlTransportOptions,
    private readonly now: () => number = () => performance.now(),
  ) {
    connection.addEventListener("datachannel", this.dataChannel);
    connection.addEventListener("connectionstatechange", this.stateChanged);
  }

  /** Offerer creates channels before its SDP offer; answerer adopts in-band channels. */
  createChannels(): void {
    if (this.destroyed || this.connection.connectionState === "closed") return;
    this.failureReason = undefined;
    try {
      if (!this.lanes.reliable)
        this.bind(
          this.connection.createDataChannel(labels.reliable, { ordered: true }),
          "reliable",
        );
      if (!this.lanes.pointer)
        this.bind(
          this.connection.createDataChannel(labels.pointer, { ordered: false, maxRetransmits: 0 }),
          "pointer",
        );
    } catch {
      this.reset();
    }
  }

  capability(): RemoteControlCapability {
    const reason = this.destroyed
      ? "transport-destroyed"
      : this.failureReason
        ? this.failureReason
        : this.connection.connectionState !== "connected"
          ? "rtc-not-connected"
          : this.lanes.reliable?.channel.readyState !== "open" ||
              this.lanes.pointer?.channel.readyState !== "open"
            ? "data-channel-unavailable"
            : !this.hello || !this.ack
              ? "remote-control-not-negotiated"
              : undefined;
    return reason ? { available: false, reason } : { available: true };
  }

  sendReliable(message: RemoteControlMessage): RemoteControlSendResult {
    return this.send(message, "reliable");
  }
  sendPointer(input: RemoteControlInputEnvelope): RemoteControlSendResult {
    return this.send({ v: 1, type: "input", input }, "pointer");
  }

  /** A rolled back initial offer must not leave duplicate connecting channels. */
  cancelPendingOffer(): void {
    if (this.lanes.reliable?.channel.readyState !== "open") this.reset();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.connection.removeEventListener("datachannel", this.dataChannel);
    this.connection.removeEventListener("connectionstatechange", this.stateChanged);
    this.reset();
    this.rates.clear();
  }

  private bindIncoming(channel: RTCDataChannel): void {
    const lane =
      channel.label === labels.reliable
        ? "reliable"
        : channel.label === labels.pointer
          ? "pointer"
          : undefined;
    if (
      !lane ||
      this.destroyed ||
      this.lanes[lane] ||
      (lane === "reliable"
        ? !channel.ordered || channel.maxRetransmits !== null || channel.maxPacketLifeTime !== null
        : channel.ordered || channel.maxRetransmits !== 0 || channel.maxPacketLifeTime !== null)
    ) {
      channel.close();
      return;
    }
    this.failureReason = undefined;
    this.bind(channel, lane);
  }

  private bind(channel: RTCDataChannel, lane: RemoteControlLane): void {
    const open = () => {
      if (lane === "reliable") this.helloSend("hello");
      this.publishCapability();
    };
    const close = () => this.invalidate("data-channel-closed");
    const message = (event: MessageEvent) => this.receive(event.data, lane);
    channel.addEventListener("open", open);
    channel.addEventListener("close", close);
    channel.addEventListener("error", close);
    channel.addEventListener("message", message);
    this.lanes[lane] = {
      channel,
      detach: () => {
        channel.removeEventListener("open", open);
        channel.removeEventListener("close", close);
        channel.removeEventListener("error", close);
        channel.removeEventListener("message", message);
      },
    };
    if (channel.readyState === "open") open();
  }

  private receive(raw: unknown, lane: RemoteControlLane): void {
    if (
      this.destroyed ||
      this.lanes[lane]?.channel.readyState !== "open" ||
      typeof raw !== "string" ||
      raw.length > MAX_BYTES ||
      encoder.encode(raw).length > MAX_BYTES
    )
      return;
    if (!this.allow(`in-${lane}`, lane)) {
      if (lane === "reliable") this.invalidate("control-rate-limit");
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (lane === "reliable" && message && typeof message === "object" && !Array.isArray(message)) {
      const hello = message as Record<string, unknown>;
      if (hello.v === 1 && Object.keys(hello).length === 2) {
        if (hello.type === "hello") {
          this.hello = true;
          this.helloSend("hello-ack");
          this.publishCapability();
          return;
        }
        if (hello.type === "hello-ack") {
          this.ack = true;
          this.publishCapability();
          return;
        }
      }
    }
    if (!this.capability().available || !validRemoteControlMessage(message, lane)) return;
    try {
      this.options.onMessage(this.peerId, message, lane);
    } catch {
      /* Host errors cannot close media. */
    }
  }

  private send(message: RemoteControlMessage, lane: RemoteControlLane): RemoteControlSendResult {
    const capability = this.capability();
    if (!capability.available) return { ok: false, reason: capability.reason! };
    if (!validRemoteControlMessage(message, lane))
      return { ok: false, reason: "invalid-control-message" };
    let payload: string;
    try {
      payload = JSON.stringify(message);
    } catch {
      return { ok: false, reason: "invalid-control-message" };
    }
    if (payload.length > MAX_BYTES || encoder.encode(payload).length > MAX_BYTES)
      return { ok: false, reason: "control-message-too-large" };
    const channel = this.lanes[lane]!.channel;
    if (
      channel.bufferedAmount + encoder.encode(payload).length >
      (lane === "pointer" ? 4096 : 65_536)
    ) {
      if (lane === "reliable") this.invalidate("control-backpressure");
      return { ok: false, reason: "control-backpressure" };
    }
    if (!this.allow(`out-${lane}`, lane)) {
      if (lane === "reliable") this.invalidate("control-rate-limit");
      return { ok: false, reason: "control-rate-limit" };
    }
    try {
      channel.send(payload);
      return { ok: true };
    } catch {
      if (lane === "reliable") this.invalidate("data-channel-send-failed");
      return { ok: false, reason: "data-channel-send-failed" };
    }
  }

  private helloSend(type: "hello" | "hello-ack"): void {
    const channel = this.lanes.reliable?.channel;
    if (channel?.readyState !== "open" || channel.bufferedAmount > 65_000) return;
    try {
      channel.send(JSON.stringify({ v: 1, type }));
    } catch {
      /* Remain unavailable. */
    }
  }

  private allow(key: string, lane: RemoteControlLane): boolean {
    const now = this.now();
    let rate = this.rates.get(key);
    if (!rate || now - rate.at >= 1000) {
      rate = { at: now, count: 0 };
      this.rates.set(key, rate);
    }
    return ++rate.count <= (lane === "pointer" ? 90 : 120);
  }

  private reset(): void {
    for (const lane of Object.values(this.lanes)) {
      lane.detach();
      try {
        lane.channel.close();
      } catch {
        /* Already closed. */
      }
    }
    this.lanes = {};
    this.hello = this.ack = false;
    this.publishCapability();
  }
  private invalidate(reason: string): void {
    this.failureReason = reason;
    this.reset();
  }
  private publishCapability(): void {
    const capability = this.capability();
    const key = JSON.stringify(capability);
    if (key === this.lastCapability) return;
    this.lastCapability = key;
    try {
      this.options.onCapabilityChange?.(this.peerId, capability);
    } catch {
      /* Media lifecycle remains independent. */
    }
  }
}
