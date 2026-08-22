import type { WebSocket } from "ws";

import type {
  CloudAiCancelMessage,
  CloudAiRequestMessage,
  CloudAiResponseMessage,
  SignalEnvelope,
} from "./protocol";
import { CloudAiService } from "./cloud-ai-service";

type CloudAiLogger = (message: string, context?: Record<string, unknown>) => void;
type CloudAiSender = (message: CloudAiResponseMessage) => void;
interface CloudAiExecutor {
  isConfigured: () => boolean;
  execute: (request: CloudAiRequestMessage, signal?: AbortSignal) => Promise<string>;
}

/** Owns per-socket cloud AI concurrency while the server keeps room authorization. */
export class CloudAiRequestController {
  private readonly inFlight = new WeakMap<
    WebSocket,
    { requestId: string; controller: AbortController }
  >();

  constructor(
    private readonly logger?: CloudAiLogger,
    private readonly service: CloudAiExecutor = new CloudAiService(),
  ) {}

  isConfigured(): boolean {
    return this.service.isConfigured();
  }

  handleSignal(socket: WebSocket, message: SignalEnvelope, send: CloudAiSender): boolean {
    if (message.type === "cloud_ai_request") {
      void this.handle(socket, message, send);
      return true;
    }
    if (message.type !== "cloud_ai_cancel") return false;
    this.cancel(socket, message);
    return true;
  }

  async handle(
    socket: WebSocket,
    message: CloudAiRequestMessage,
    send: CloudAiSender,
  ): Promise<void> {
    if (this.inFlight.has(socket)) {
      send({
        type: "cloud_ai_response",
        roomId: message.roomId,
        peerId: message.peerId,
        requestId: message.requestId,
        ok: false,
        errorCode: "cloud_ai_request_in_progress",
      });
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(socket, { requestId: message.requestId, controller });
    try {
      const content = await this.service.execute(message, controller.signal);
      send({
        type: "cloud_ai_response",
        roomId: message.roomId,
        peerId: message.peerId,
        requestId: message.requestId,
        ok: true,
        content,
      });
      this.logResult("cloud AI request completed", message);
    } catch (error) {
      const reason = controller.signal.aborted
        ? "cloud_ai_cancelled"
        : error instanceof Error
          ? error.message
          : "cloud_ai_unavailable";
      const errorCode = reason.startsWith("cloud_ai_") ? reason : "cloud_ai_unavailable";
      send({
        type: "cloud_ai_response",
        roomId: message.roomId,
        peerId: message.peerId,
        requestId: message.requestId,
        ok: false,
        errorCode,
      });
      this.logResult("cloud AI request failed", message, errorCode);
    } finally {
      this.inFlight.delete(socket);
    }
  }

  cancel(socket: WebSocket, message: CloudAiCancelMessage): boolean {
    const active = this.inFlight.get(socket);
    if (!active || active.requestId !== message.requestId) return false;
    active.controller.abort();
    this.logResult("cloud AI request cancelled", message, "cloud_ai_cancelled");
    return true;
  }

  cancelSocket(socket: WebSocket): void {
    this.inFlight.get(socket)?.controller.abort();
  }

  private logResult(
    event: string,
    message: CloudAiRequestMessage | CloudAiCancelMessage,
    errorCode?: string,
  ): void {
    this.logger?.(event, {
      roomId: message.roomId,
      peerId: message.peerId,
      ...("purpose" in message ? { purpose: message.purpose } : {}),
      ...(errorCode ? { errorCode } : {}),
    });
  }
}
