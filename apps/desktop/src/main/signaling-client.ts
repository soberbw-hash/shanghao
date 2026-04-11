import { EventEmitter } from "node:events";

import type { RendererLogPayload, SignalingEventPayload } from "@private-voice/shared";

type BridgeSocket = {
  once(event: "open" | "close", listener: (...args: any[]) => void): void;
  on(event: "message" | "close" | "error", listener: (...args: any[]) => void): void;
  send(payload: string): void;
  close(): void;
  readyState: number;
};

type WebSocketConstructor = {
  new (url: string, options?: { handshakeTimeout?: number }): BridgeSocket;
  OPEN: number;
};

const NodeWebSocket = require("ws") as WebSocketConstructor;

export class SignalingClientBridge extends EventEmitter {
  private socket?: BridgeSocket;

  constructor(
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {
    super();
  }

  async connect(signalingUrl: string): Promise<void> {
    await this.close();

    await this.writeLog({
      category: "signaling",
      level: "info",
      message: "Opening signaling bridge socket",
      context: { signalingUrl },
    });

    await new Promise<void>((resolve, reject) => {
      const socket = new NodeWebSocket(signalingUrl, {
        handshakeTimeout: 8_000,
      });
      this.socket = socket;

      socket.once("open", () => {
        this.emitEvent({ type: "open" });
        void this.writeLog({
          category: "signaling",
          level: "info",
          message: "Signaling bridge socket opened",
          context: { signalingUrl },
        });
        resolve();
      });

      socket.on("message", (data: string | Buffer) => {
        this.emitEvent({
          type: "message",
          data: typeof data === "string" ? data : data.toString(),
        });
      });

      socket.on("close", (code: number, reason: Buffer) => {
        this.emitEvent({
          type: "close",
          code,
          reason: reason.toString(),
        });
        void this.writeLog({
          category: "signaling",
          level: "warn",
          message: "Signaling bridge socket closed",
          context: { code, reason: reason.toString() },
        });
      });

      socket.on("error", (error: Error) => {
        this.emitEvent({
          type: "error",
          message: error.message,
        });
        void this.writeLog({
          category: "signaling",
          level: "error",
          message: "Signaling bridge socket error",
          context: { error: error.message },
        });
        reject(error);
      });
    });
  }

  async send(payload: string): Promise<void> {
    if (!this.socket || this.socket.readyState !== NodeWebSocket.OPEN) {
      throw new Error("signaling_not_connected");
    }

    this.socket.send(payload);
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
