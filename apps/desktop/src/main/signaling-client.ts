import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket as NodeWebSocket, type RawData } from "ws";

import type {
  RealtimeFaultCommand,
  RendererLogPayload,
  SignalingEventPayload,
} from "@private-voice/shared";
export interface CloudAiBridgeRequest {
  purpose: "organize" | "question";
  prompt: string;
  useWebSearch?: boolean;
  signal?: AbortSignal;
}

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
  private joinedRoom?: { roomId: string; peerId: string };
  private readonly pendingCloudAi = new Map<
    string,
    { resolve: (content: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
    private readonly getAccountAccessToken: () =>
      string | undefined | Promise<string | undefined> = () => undefined,
  ) {
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

    // Refresh through the main-process account service before opening the
    // socket. This is important for CloudBase sessions restored after a long
    // idle period and also prevents concurrent reconnects from using an
    // already-expired bearer token.
    const accountAccessToken = await this.getAccountAccessToken();

    await new Promise<void>((resolve, reject) => {
      const socket = new NodeWebSocket(signalingUrl, {
        handshakeTimeout: 8_000,
        headers: accountAccessToken ? { Authorization: `Bearer ${accountAccessToken}` } : undefined,
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
        const payloadText = data.toString();
        if (this.handleBridgeMessage(payloadText)) return;
        this.emitEvent(sessionId, {
          type: "message",
          data: payloadText,
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
        this.joinedRoom = undefined;
        this.rejectPendingCloudAi("cloud_ai_connection_closed");
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
    try {
      const message = JSON.parse(payload) as { type?: string };
      if (message.type === "leave_channel") this.joinedRoom = undefined;
    } catch {
      // Renderer payload validation happens in IPC before this bridge is called.
    }
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
    this.joinedRoom = undefined;
    this.rejectPendingCloudAi("cloud_ai_connection_closed");
    await this.closeSocket();
  }

  async prepareForUpdate(): Promise<boolean> {
    if (!this.joinedRoom || this.socket?.readyState !== NodeWebSocket.OPEN) return false;
    this.socketGeneration += 1;
    this.sessionId = undefined;
    this.joinedRoom = undefined;
    this.rejectPendingCloudAi("cloud_ai_connection_closed");
    return this.closeSocket(4002, "client_updating");
  }

  async requestCloudAi(request: CloudAiBridgeRequest): Promise<string> {
    if (!this.socket || this.socket.readyState !== NodeWebSocket.OPEN || !this.joinedRoom) {
      throw new Error("cloud_ai_join_required");
    }
    const requestId = randomUUID();
    const { roomId, peerId } = this.joinedRoom;
    return new Promise<string>((resolve, reject) => {
      const finish = (error?: Error, content?: string) => {
        const pending = this.pendingCloudAi.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        request.signal?.removeEventListener("abort", abort);
        this.pendingCloudAi.delete(requestId);
        if (error) reject(error);
        else resolve(content ?? "");
      };
      const abort = () => {
        if (this.socket?.readyState === NodeWebSocket.OPEN) {
          try {
            this.socket.send(
              JSON.stringify({
                type: "cloud_ai_cancel",
                roomId,
                peerId,
                requestId,
              }),
            );
          } catch {
            // The local request still stops even if the socket closes during cancellation.
          }
        }
        finish(new Error("ai_task_paused"));
      };
      const timer = setTimeout(() => finish(new Error("cloud_ai_timeout")), 90_000);
      timer.unref?.();
      this.pendingCloudAi.set(requestId, {
        resolve: (content) => finish(undefined, content),
        reject: (error) => finish(error),
        timer,
      });
      request.signal?.addEventListener("abort", abort, { once: true });
      if (request.signal?.aborted) {
        abort();
        return;
      }
      try {
        this.socket?.send(
          JSON.stringify({
            type: "cloud_ai_request",
            roomId,
            peerId,
            requestId,
            purpose: request.purpose,
            responseFormat: "json",
            prompt: request.prompt.slice(0, 48_000),
            useWebSearch: request.useWebSearch === true,
          }),
        );
      } catch {
        finish(new Error("cloud_ai_send_failed"));
      }
    });
  }

  injectFault(sessionId: string, command: RealtimeFaultCommand): void {
    if (sessionId !== this.sessionId) throw new Error("signaling_session_superseded");
    if (command.kind === "signal_disconnect") {
      this.socket?.terminate();
      return;
    }
    if (command.kind === "stale_socket_close") {
      this.emitEvent(`${sessionId}:stale`, {
        type: "close",
        code: 4_001,
        reason: "fault_lab_stale_socket_close",
      });
      return;
    }
    if (command.kind === "duplicate_socket_close") {
      const payload = {
        type: "close" as const,
        code: 4_002,
        reason: "fault_lab_duplicate_socket_close",
      };
      this.emitEvent(sessionId, payload);
      this.emitEvent(sessionId, payload);
      return;
    }
    throw new Error("fault_must_be_injected_in_renderer");
  }

  private async closeSocket(code = 1000, reason?: string): Promise<boolean> {
    if (!this.socket) return false;

    const socket = this.socket;
    this.socket = undefined;

    return new Promise<boolean>((resolve) => {
      if (socket.readyState === NodeWebSocket.CLOSED) {
        resolve(true);
        return;
      }
      const fallback = setTimeout(() => resolve(false), 1_500);
      socket.once("close", () => {
        clearTimeout(fallback);
        resolve(true);
      });
      try {
        socket.close(code, reason);
      } catch {
        clearTimeout(fallback);
        resolve(false);
      }
    });
  }

  private handleBridgeMessage(payloadText: string): boolean {
    try {
      const message = JSON.parse(payloadText) as {
        type?: string;
        roomId?: string;
        peerId?: string;
        requestId?: string;
        ok?: boolean;
        content?: string;
        errorCode?: string;
      };
      if (message.type === "join_ack" && message.roomId && message.peerId) {
        this.joinedRoom = { roomId: message.roomId, peerId: message.peerId };
        return false;
      }
      if (message.type === "error" && this.pendingCloudAi.size > 0) {
        const code = String((message as { code?: unknown }).code ?? "");
        if (code === "invalid_payload" || code === "server_message_not_allowed") {
          this.rejectPendingCloudAi("cloud_ai_unsupported");
          return true;
        }
        if (code === "rate_limited") {
          this.rejectPendingCloudAi("cloud_ai_busy");
          return true;
        }
      }
      if (message.type !== "cloud_ai_response" || typeof message.requestId !== "string") {
        return false;
      }
      const pending = this.pendingCloudAi.get(message.requestId);
      if (!pending) return true;
      if (message.ok && typeof message.content === "string") pending.resolve(message.content);
      else pending.reject(new Error(message.errorCode || "cloud_ai_request_failed"));
      return true;
    } catch {
      return false;
    }
  }

  private rejectPendingCloudAi(code: string): void {
    for (const pending of this.pendingCloudAi.values()) pending.reject(new Error(code));
    this.pendingCloudAi.clear();
  }

  private emitEvent(
    sessionId: string,
    payload: Omit<SignalingEventPayload, "sessionId" | "generation">,
  ): void {
    this.emit("event", {
      ...payload,
      sessionId,
      generation: this.socketGeneration,
    } satisfies SignalingEventPayload);
  }
}
