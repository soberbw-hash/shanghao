import { EventEmitter } from "node:events";
import { WebSocket as NodeWebSocket, type RawData } from "ws";

import type { RendererLogPayload, SignalingEventPayload } from "@private-voice/shared";

const sanitizeSignalingUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "invalid";
  }
};

export class SignalingClientBridge extends EventEmitter {
  private socket?: NodeWebSocket;
  private maxBufferedAmount = 0;
  private droppedByBackpressure = 0;
  private sentAudioChunks = 0;
  private skippedAudioChunks = 0;
  private lastBackpressureLogAt = 0;

  constructor(private readonly writeLog: (payload: RendererLogPayload) => Promise<void>) {
    super();
  }

  async connect(signalingUrl: string): Promise<void> {
    await this.close();
    const mode = (() => {
      try {
        return new URL(signalingUrl).searchParams.get("mode") ?? "unknown";
      } catch {
        return "unknown";
      }
    })();
    const safeSignalingUrl = sanitizeSignalingUrl(signalingUrl);

    await this.writeLog({
      category: mode === "relay" ? "relay" : "signaling",
      level: "info",
      message: "Opening signaling bridge socket",
      context: { signalingUrl: safeSignalingUrl, mode },
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new NodeWebSocket(signalingUrl, {
        handshakeTimeout: 8_000,
      });
      this.socket = socket;

      socket.once("open", () => {
        this.emitEvent({ type: "open" });
        void this.writeLog({
          category: mode === "relay" ? "relay" : "signaling",
          level: "info",
          message: "Signaling bridge socket opened",
          context: { signalingUrl: safeSignalingUrl, mode },
        });
        resolve();
      });

      socket.on("message", (data: RawData) => {
        this.emitEvent({
          type: "message",
          data: data.toString(),
        });
      });

      socket.on("close", (code: number, reason: Buffer) => {
        this.emitEvent({
          type: "close",
          code,
          reason: reason.toString(),
        });
        void this.writeLog({
          category: mode === "relay" ? "relay" : "signaling",
          level: "warn",
          message: "Signaling bridge socket closed",
          context: { code, reason: reason.toString(), mode },
        });
      });

      socket.on("error", (error: Error) => {
        this.emitEvent({
          type: "error",
          message: error.message,
        });
        void this.writeLog({
          category: mode === "relay" ? "relay" : "signaling",
          level: "error",
          message: "Signaling bridge socket error",
          context: { error: error.message, mode },
        });
        reject(error);
      });
    });
  }

  async send(payload: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== NodeWebSocket.OPEN) {
      throw new Error("signaling_not_connected");
    }

    const isAudioChunk = payload.includes('"type":"audio_chunk"');
    const bufferedAmount = this.socket.bufferedAmount;
    this.maxBufferedAmount = Math.max(this.maxBufferedAmount, bufferedAmount);
    if (isAudioChunk && bufferedAmount >= 512 * 1024) {
      this.droppedByBackpressure += 1;
      this.skippedAudioChunks += 1;
      await this.logBackpressureMetrics(bufferedAmount >= 1024 * 1024 ? "error" : "warn");
      return;
    }

    this.socket.send(payload);
    if (isAudioChunk) {
      this.sentAudioChunks += 1;
      if (bufferedAmount >= 256 * 1024) {
        await this.logBackpressureMetrics("warn");
      }
    }
  }

  private async logBackpressureMetrics(level: RendererLogPayload["level"]): Promise<void> {
    const now = Date.now();
    if (now - this.lastBackpressureLogAt < 5_000) {
      return;
    }
    await this.writeLog({
      category: "audio",
      level,
      message: "signaling audio websocket backpressure metrics",
      context: {
        maxBufferedAmount: this.maxBufferedAmount,
        droppedByBackpressure: this.droppedByBackpressure,
        sentAudioChunks: this.sentAudioChunks,
        skippedAudioChunks: this.skippedAudioChunks,
      },
    });
    this.lastBackpressureLogAt = now;
    this.maxBufferedAmount = 0;
    this.droppedByBackpressure = 0;
    this.sentAudioChunks = 0;
    this.skippedAudioChunks = 0;
  }

  async close(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = undefined;

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      try {
        socket.close();
      } catch {
        resolve();
      }
    });
  }

  private emitEvent(payload: SignalingEventPayload): void {
    this.emit("event", payload);
  }
}
