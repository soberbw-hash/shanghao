import type { ChatImageAttachment, ChatMessage, ChatRecallEvent } from "@private-voice/shared";
import type {
  ChatAckMessage,
  ChatHistoryMessage,
  ChatMessage as SignalChatMessage,
  ChatRecallMessage,
  ChatRejectedMessage,
} from "@private-voice/signaling";

import { writeRendererLog } from "../../utils/logger";
import { serverBuildSupportsReliableChat } from "./serverCapabilities";

const MAX_CLIENT_SIGNAL_PAYLOAD_BYTES = 256 * 1024;
const CHAT_ACK_TIMEOUT_MS = 4_000;
const CHAT_SEND_DEADLINE_MS = 20_000;
const CHAT_MAX_RETRIES = 3;

interface PendingChatSend {
  payload: SignalChatMessage & { clientMessageId: string };
  resolve: (ack: ChatAckMessage) => void;
  reject: (error: Error) => void;
  startedAt: number;
  retryCount: number;
  timeout?: number;
}

interface ReliableChatTransportOptions {
  roomId: string;
  peerId: string;
  canSend: () => boolean;
  getServerBuildNumber: () => string | undefined;
  send: (payload: SignalChatMessage) => Promise<void>;
  onMessage: (message: ChatMessage) => void;
  onHistory: (messages: ChatMessage[]) => void;
  onRecall: (event: ChatRecallEvent) => void;
}

export class ReliableChatTransport {
  private readonly pendingSends = new Map<string, PendingChatSend>();
  private failureCount = 0;

  constructor(private readonly options: ReliableChatTransportOptions) {}

  getFailureCount(): number {
    return this.failureCount;
  }

  async sendMessage(
    content: string,
    image?: ChatImageAttachment,
    clientMessageId: string = crypto.randomUUID(),
  ): Promise<ChatAckMessage> {
    const trimmed = content.trim();
    if (!trimmed && !image) throw new Error("empty_chat_message");
    if (!this.options.canSend()) throw new Error("signaling_not_connected");

    const payload: SignalChatMessage & { clientMessageId: string } = {
      type: "chat_message",
      roomId: this.options.roomId,
      clientMessageId,
      content: trimmed,
      image,
    };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
    if (payloadBytes > MAX_CLIENT_SIGNAL_PAYLOAD_BYTES) {
      throw new Error("chat_payload_too_large");
    }

    const existing = this.pendingSends.get(clientMessageId);
    if (existing) {
      return new Promise<ChatAckMessage>((resolve, reject) => {
        const previousResolve = existing.resolve;
        const previousReject = existing.reject;
        existing.resolve = (ack) => {
          previousResolve(ack);
          resolve(ack);
        };
        existing.reject = (error) => {
          previousReject(error);
          reject(error);
        };
      });
    }

    return new Promise<ChatAckMessage>((resolve, reject) => {
      const pending: PendingChatSend = {
        payload,
        resolve,
        reject,
        startedAt: Date.now(),
        retryCount: 0,
      };
      this.pendingSends.set(clientMessageId, pending);
      void this.transmit(pending, payloadBytes);
    });
  }

  retryPending(): void {
    for (const pending of this.pendingSends.values()) {
      if (pending.timeout) window.clearTimeout(pending.timeout);
      pending.timeout = undefined;
      if (serverBuildSupportsReliableChat(this.options.getServerBuildNumber())) {
        void this.transmit(pending);
      } else {
        this.fail(pending.payload.clientMessageId, "legacy_chat_confirmation_lost");
      }
    }
  }

  rejectPending(reason: string): void {
    for (const clientMessageId of [...this.pendingSends.keys()]) {
      this.fail(clientMessageId, reason);
    }
  }

  handleAck(payload: ChatAckMessage): void {
    const pending = this.pendingSends.get(payload.clientMessageId);
    if (!pending || payload.peerId !== this.options.peerId) return;
    if (pending.timeout) window.clearTimeout(pending.timeout);
    this.pendingSends.delete(payload.clientMessageId);
    pending.resolve(payload);
    void writeRendererLog("signaling", "info", "Chat message acknowledged", {
      roomId: payload.roomId,
      clientMessageId: payload.clientMessageId,
      messageId: payload.messageId,
      retryCount: Math.max(0, pending.retryCount - 1),
      ackLatencyMs: Date.now() - pending.startedAt,
      duplicate: payload.duplicate,
    });
  }

  handleRejected(payload: ChatRejectedMessage): void {
    this.fail(payload.clientMessageId, payload.code);
  }

  handleMessage(payload: SignalChatMessage): void {
    if (!payload.id || !payload.peerId || !payload.nickname || !payload.createdAt) return;
    const isLocal = payload.peerId === this.options.peerId;
    const clientMessageId =
      payload.clientMessageId ?? (isLocal ? this.findLegacyPending(payload) : undefined);
    if (isLocal && clientMessageId && this.pendingSends.has(clientMessageId)) {
      this.handleAck({
        type: "chat_ack",
        roomId: payload.roomId,
        peerId: payload.peerId,
        clientMessageId,
        messageId: payload.id,
        acceptedAt: payload.createdAt,
        duplicate: false,
      });
    }
    this.options.onMessage({
      id: payload.id,
      clientMessageId,
      peerId: payload.peerId,
      nickname: payload.nickname,
      avatarDataUrl: payload.avatarDataUrl,
      avatarId: payload.avatarId,
      content: payload.content,
      image: payload.image,
      createdAt: payload.createdAt,
      isLocal,
      deliveryState: "sent",
    });
  }

  handleHistory(payload: ChatHistoryMessage): void {
    this.options.onHistory(
      payload.messages.map((message) => ({
        ...message,
        isLocal: message.peerId === this.options.peerId,
        kind: "chat" as const,
      })),
    );
  }

  handleRecall(payload: ChatRecallMessage): void {
    if (!payload.peerId || !payload.recalledAt) return;
    this.options.onRecall({
      messageId: payload.messageId,
      peerId: payload.peerId,
      recalledAt: payload.recalledAt,
    });
  }

  private async transmit(pending: PendingChatSend, payloadBytes?: number): Promise<void> {
    if (!this.pendingSends.has(pending.payload.clientMessageId)) return;
    if (!this.options.canSend()) {
      this.scheduleRetry(pending);
      return;
    }
    try {
      pending.retryCount += 1;
      await this.options.send(pending.payload);
      void writeRendererLog("signaling", "info", "Chat message submitted", {
        roomId: this.options.roomId,
        clientMessageId: pending.payload.clientMessageId,
        kind: pending.payload.image ? "image" : "text",
        payloadBytes:
          payloadBytes ?? new TextEncoder().encode(JSON.stringify(pending.payload)).byteLength,
        retryCount: Math.max(0, pending.retryCount - 1),
        acknowledgementMode: serverBuildSupportsReliableChat(this.options.getServerBuildNumber())
          ? "ack"
          : "legacy_echo",
      });
      if (serverBuildSupportsReliableChat(this.options.getServerBuildNumber())) {
        this.scheduleRetry(pending);
      } else {
        this.scheduleLegacyConfirmation(pending);
      }
    } catch (error) {
      if (serverBuildSupportsReliableChat(this.options.getServerBuildNumber())) {
        this.scheduleRetry(pending, error);
      } else {
        this.fail(
          pending.payload.clientMessageId,
          error instanceof Error ? error.message : "chat_send_failed",
        );
      }
    }
  }

  private scheduleLegacyConfirmation(pending: PendingChatSend): void {
    if (!this.pendingSends.has(pending.payload.clientMessageId)) return;
    if (pending.timeout) window.clearTimeout(pending.timeout);
    pending.timeout = window.setTimeout(
      () => this.fail(pending.payload.clientMessageId, "legacy_chat_echo_timeout"),
      CHAT_SEND_DEADLINE_MS,
    );
  }

  private scheduleRetry(pending: PendingChatSend, sendError?: unknown): void {
    if (pending.timeout) window.clearTimeout(pending.timeout);
    const elapsed = Date.now() - pending.startedAt;
    if (elapsed >= CHAT_SEND_DEADLINE_MS || pending.retryCount >= CHAT_MAX_RETRIES) {
      this.fail(
        pending.payload.clientMessageId,
        sendError instanceof Error ? sendError.message : "chat_ack_timeout",
      );
      return;
    }
    pending.timeout = window.setTimeout(() => {
      pending.timeout = undefined;
      void this.transmit(pending);
    }, CHAT_ACK_TIMEOUT_MS);
  }

  private fail(clientMessageId: string, reason: string): void {
    const pending = this.pendingSends.get(clientMessageId);
    if (!pending) return;
    if (pending.timeout) window.clearTimeout(pending.timeout);
    this.pendingSends.delete(clientMessageId);
    this.failureCount += 1;
    pending.reject(new Error(reason));
    void writeRendererLog("signaling", "warn", "Chat message failed", {
      roomId: this.options.roomId,
      clientMessageId,
      kind: pending.payload.image ? "image" : "text",
      retryCount: Math.max(0, pending.retryCount - 1),
      failureReason: reason,
    });
  }

  private findLegacyPending(payload: SignalChatMessage): string | undefined {
    // Some already-deployed servers advertise the reliable-chat build number
    // but still send the older echo shape without clientMessageId/chat_ack.
    // Treat the first matching local echo as the acknowledgement so the normal
    // four-second retry does not create two additional server messages.
    const normalizedContent = payload.content.trim();
    const imageDataUrl = payload.image?.dataUrl;
    return [...this.pendingSends.values()]
      .sort((left, right) => left.startedAt - right.startedAt)
      .find(
        (pending) =>
          pending.payload.content === normalizedContent &&
          pending.payload.image?.dataUrl === imageDataUrl,
      )?.payload.clientMessageId;
  }
}
