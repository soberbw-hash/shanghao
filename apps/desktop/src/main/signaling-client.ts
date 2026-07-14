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
  private sessionId?: string;
  private socketGeneration = 0;
  private maxBufferedAmount = 0;
  private droppedByBackpressure = 0;
  private sentAudioChunks = 0;
  private skippedAudioChunks = 0;
  private lastBackpressureLogAt = 0;

  constructor(private readonly writeLog: (payload: RendererLogPayload) => Promise<void>) {
    super();
  }

  async connect(signalingUrl: string, sessionId: string): Promise<void> {
    const generation = ++this.socketGeneration;
    // Claim the bridge before closing the previous socket so a late close request
    // from the old renderer session cannot cancel the replacement connection.
    this.sessionId = sessionId;
    await this.closeSocket();
    if (generation !== this.socketGeneration || this.sessionId !== sessionId) {
      throw new Error("signaling_session_superseded");
    }
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
      let settled = false;
      let opened = false;
      const isCurrentSocket = () =>
        this.socket === socket &&
        this.sessionId === sessionId &&
        this.socketGeneration === generation;
      const resolveOnce = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectOnce = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      socket.once("open", () => {
        if (!isCurrentSocket()) {
          rejectOnce(new Error("signaling_session_superseded"));
          socket.close();
          return;
        }
        opened = true;
        this.emitEvent(sessionId, { type: "open" });
        void this.writeLog({
          category: mode === "relay" ? "relay" : "signaling",
          level: "info",
          message: "Signaling bridge socket opened",
          context: { signalingUrl: safeSignalingUrl, mode },
        });
        resolveOnce();
      });

      socket.on("message", (data: RawData) => {
        if (!isCurrentSocket()) return;
        this.emitEvent(sessionId, {
          type: "message",
          data: data.toString(),
        });
      });

      socket.on("close", (code: number, reason: Buffer) => {
        if (!isCurrentSocket()) {
          rejectOnce(new Error("signaling_session_superseded"));
          void this.writeLog({
            category: mode === "relay" ? "relay" : "signaling",
            level: "info",
            message: "Ignored stale signaling bridge close event",
            context: { code, mode },
          });
          return;
        }
        this.socket = undefined;
        if (!opened) rejectOnce(new Error("signaling_socket_closed"));
        this.emitEvent(sessionId, {
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
        if (!isCurrentSocket()) {
          rejectOnce(new Error("signaling_session_superseded"));
          return;
        }
        this.emitEvent(sessionId, {
          type: "error",
          message: error.message,
        });
        void this.writeLog({
          category: mode === "relay" ? "relay" : "signaling",
          level: "error",
          message: "Signaling bridge socket error",
          context: { error: error.message, mode },
        });
        rejectOnce(error);
      });
    });
  }

  async send(payload: string, sessionId: string): Promise<void> {
    if (sessionId !== this.sessionId) {
      throw new Error("signaling_session_superseded");
    }
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

  async close(sessionId: string): Promise<void> {
    if (this.sessionId && this.sessionId !== sessionId) {
      await this.writeLog({
        category: "signaling",
        level: "info",
        message: "Ignored close request from stale signaling session",
      });
      return;
    }
    this.socketGeneration += 1;
    this.sessionId = undefined;
    await this.closeSocket();
  }

  private async closeSocket(): Promise<void> {
    if (!this.socket) return;

    const socket = this.socket;
    this.socket = undefined;

    await new Promise<void>((resolve) => {
      if (socket.readyState === NodeWebSocket.CLOSED) {
        resolve();
        return;
      }
      const fallback = setTimeout(resolve, 1_500);
      socket.once("close", () => {
        clearTimeout(fallback);
        resolve();
      });
      try {
        socket.close();
      } catch {
        clearTimeout(fallback);
        resolve();
      }
    });
  }

  private emitEvent(sessionId: string, payload: Omit<SignalingEventPayload, "sessionId">): void {
    this.emit("event", { ...payload, sessionId } satisfies SignalingEventPayload);
  }
}
