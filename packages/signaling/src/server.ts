import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
} from "@private-voice/shared";
import { WebSocket, WebSocketServer } from "ws";

import type {
  AudioChunkMessage,
  AvatarUpdateMessage,
  ChatMessage,
  ErrorMessage,
  HelloMessage,
  IceCandidateMessage,
  JoinRoomMessage,
  JoinAckMessage,
  LeaveRoomMessage,
  MemberStateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  RoomSnapshotMessage,
  RequestSnapshotMessage,
  SignalEnvelope,
} from "./protocol";
import { isSignalEnvelope } from "./protocol";
import { RoomManager } from "./room-manager";

interface SignalingServerOptions {
  port?: number;
  roomName: string;
  packageVersion?: string;
  logger?: (message: string, context?: Record<string, unknown>) => void;
}

const MAX_SIGNALING_PAYLOAD_BYTES = 256 * 1024;
const MAX_AVATAR_BYTES = 128 * 1024;

const normalizeAvatar = (
  avatarDataUrl?: string,
): { avatarDataUrl?: string; avatarHash?: string } => {
  if (!avatarDataUrl || Buffer.byteLength(avatarDataUrl, "utf8") > MAX_AVATAR_BYTES) {
    return {};
  }

  return {
    avatarDataUrl,
    avatarHash: createHash("sha256").update(avatarDataUrl).digest("hex"),
  };
};

export class SignalingServer extends EventEmitter {
  private readonly roomManager = new RoomManager();
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly roomName: string;
  private readonly logger?: SignalingServerOptions["logger"];
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private readonly options: SignalingServerOptions) {
    super();
    this.roomName = options.roomName;
    this.logger = options.logger;
    this.httpServer = createServer();
    this.httpServer.on("request", (request, response) => {
      if (request.url?.startsWith("/health")) {
        const stats = this.roomManager.getStats();
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            ok: true,
            name: "shanghao-signaling",
            roomName: this.roomName,
            protocolVersion: APP_PROTOCOL_VERSION,
            buildNumber: APP_BUILD_NUMBER,
            packageVersion: this.options.packageVersion ?? process.env.npm_package_version ?? "unknown",
            uptime: process.uptime(),
            activeRooms: stats.activeRooms,
            connectedPeers: stats.connectedPeers,
            now: new Date().toISOString(),
          }),
        );
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("ShangHao signaling server");
    });
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  async listen(): Promise<number> {
    const preferredPort = this.options.port ?? 0;

    try {
      await this.listenOnPort(preferredPort);
    } catch (error) {
      if (
        preferredPort !== 0 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "EADDRINUSE"
      ) {
        this.logger?.("preferred signaling port occupied, falling back", {
          preferredPort,
        });
        await this.listenOnPort(0);
      } else {
        throw error;
      }
    }

    this.heartbeatTimer = setInterval(() => {
      for (const stale of this.roomManager.collectStalePeers()) {
        this.roomManager.removePeer(stale.roomId, stale.peerId);
        this.broadcastSnapshot(stale.roomId);
      }
    }, HEARTBEAT_INTERVAL_MS);

    const address = this.httpServer.address();
    const listeningPort = address && typeof address === "object" ? address.port : preferredPort;

    this.logger?.("signaling server listening", { port: listeningPort });
    return listeningPort;
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    for (const client of this.wss.clients) {
      client.close();
    }

    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async listenOnPort(port: number): Promise<void> {
    try {
      await this.listenOnHost(port, "::");
      this.logger?.("signaling server bound on dual-stack host", { host: "::", port });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: string }).code
          : undefined;

      if (code !== "EAFNOSUPPORT" && code !== "EADDRNOTAVAIL") {
        throw error;
      }

      this.logger?.("ipv6 dual-stack bind unavailable, falling back to ipv4", {
        port,
        code,
      });
      await this.listenOnHost(port, "0.0.0.0");
    }
  }

  private async listenOnHost(port: number, host: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const handleError = (error: Error) => {
        this.httpServer.off("listening", handleListening);
        reject(error);
      };

      const handleListening = () => {
        this.httpServer.off("error", handleError);
        resolve();
      };

      this.httpServer.once("error", handleError);
      this.httpServer.once("listening", handleListening);
      this.httpServer.listen({
        port,
        host,
        ipv6Only: false,
      });
    });
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      try {
        const payloadText = raw.toString();
        if (Buffer.byteLength(payloadText, "utf8") > MAX_SIGNALING_PAYLOAD_BYTES) {
          this.safeSend(socket, {
            type: "error",
            code: "payload_too_large",
            message: "Signaling message exceeds the 256KB limit.",
          });
          return;
        }
        const payload = JSON.parse(payloadText) as unknown;
        if (!isSignalEnvelope(payload)) {
          return;
        }
        this.handleSignal(socket, payload);
      } catch (error) {
        const message: ErrorMessage = {
          type: "error",
          code: "invalid_payload",
          message: error instanceof Error ? error.message : "Unknown signaling error",
        };
        this.safeSend(socket, message);
      }
    });

    socket.on("close", (code, reason) => {
      const roomId = Reflect.get(socket, "__roomId") as string | undefined;
      const peerId = Reflect.get(socket, "__peerId") as string | undefined;

      if (roomId && peerId) {
        const marked = this.roomManager.markPeerDisconnected(roomId, peerId, socket);
        this.logger?.("peer socket closed", {
          roomId,
          peerId,
          code,
          reason: reason.toString(),
          reconnectGraceActive: marked,
        });
        if (marked) {
          this.broadcastSnapshot(roomId);
        }
      }
    });
  }

  private handleSignal(socket: WebSocket, message: SignalEnvelope): void {
    if (message.roomId && message.peerId) {
      this.roomManager.getRoom(message.roomId)?.peers.updateHeartbeat(message.peerId);
    }

    switch (message.type) {
      case "hello":
      case "join_room":
        this.handleJoin(socket, message);
        return;
      case "leave_room":
        this.handleLeave(message);
        return;
      case "heartbeat":
        this.roomManager.getRoom(message.roomId)?.peers.updateHeartbeat(message.peerId);
        return;
      case "request_snapshot":
        this.handleSnapshotRequest(socket, message);
        return;
      case "peer_offer":
      case "peer_answer":
      case "ice_candidate":
        this.forwardPeerSignal(message);
        return;
      case "member_state":
        this.handleMemberState(message);
        return;
      case "chat_message":
        this.broadcastChatMessage(message);
        return;
      case "audio_chunk":
        this.broadcastAudioChunk(message);
        return;
      default:
        return;
    }
  }

  private handleJoin(socket: WebSocket, message: HelloMessage | JoinRoomMessage): void {
    if (message.protocolVersion !== APP_PROTOCOL_VERSION) {
      const mismatchMessage: ErrorMessage = {
        type: "error",
        code: "version_mismatch",
        roomId: message.roomId,
        peerId: message.peerId,
        message: "房主和成员版本不一致，请升级到同一版本。",
      };
      this.safeSend(socket, mismatchMessage);
      return;
    }

    const existingRoom = this.roomManager.getRoom(message.roomId);
    if (
      message.connectionMode === "relay" &&
      existingRoom?.relayToken &&
      existingRoom.relayToken !== message.relayToken
    ) {
      const relayMessage: ErrorMessage = {
        type: "error",
        code: "relay_auth_failed",
        roomId: message.roomId,
        peerId: message.peerId,
        message: "云中继鉴权失败，请让房主重新分享房间地址。",
      };
      this.safeSend(socket, relayMessage);
      return;
    }

    const existingPeer = existingRoom?.peers.getPeer(message.peerId);
    if (!existingPeer && !this.roomManager.canJoin(message.roomId)) {
      const roomFullMessage: ErrorMessage = {
        type: "error",
        code: "room_full",
        roomId: message.roomId,
        peerId: message.peerId,
        message: "房间已满，最多只能同时 5 人语音。",
      };
      this.safeSend(socket, roomFullMessage);
      return;
    }

    Reflect.set(socket, "__roomId", message.roomId);
    Reflect.set(socket, "__peerId", message.peerId);
    const existingPeerCount = existingRoom?.peers.listPeers().length ?? 0;
    if (existingPeer && existingPeer.socket !== socket) {
      try {
        existingPeer.socket.close(4001, "peer_reconnected");
      } catch {
        // The replacement socket remains authoritative even if the old socket is already gone.
      }
    }

    const normalizedAvatar = normalizeAvatar(message.avatarDataUrl);
    const room = this.roomManager.addPeer(
      message.roomId,
      this.roomName,
      {
        id: message.peerId,
        nickname: message.nickname,
        avatarDataUrl: normalizedAvatar.avatarDataUrl ?? existingPeer?.avatarDataUrl,
        avatarHash: normalizedAvatar.avatarHash ?? existingPeer?.avatarHash,
        socket,
        isHost: existingPeer?.isHost ?? existingPeerCount === 0,
        isMuted: existingPeer?.isMuted ?? false,
        isSpeaking: existingPeer?.isSpeaking ?? false,
        joinedAt: existingPeer?.joinedAt ?? new Date().toISOString(),
        lastHeartbeatAt: Date.now(),
        disconnectedAt: undefined,
      },
      message.connectionMode === "relay" ? message.relayToken : undefined,
    );

    room.appVersion = message.appVersion;
    room.protocolVersion = APP_PROTOCOL_VERSION;
    room.buildNumber = APP_BUILD_NUMBER;
    room.connectionMode = message.connectionMode;
    this.logger?.(existingPeer ? "peer reconnected" : "peer joined", {
      roomId: message.roomId,
      peerId: message.peerId,
      memberCount: room.peers.listPeers().length,
    });

    const joinAck: JoinAckMessage = {
      type: "join_ack",
      roomId: room.roomId,
      peerId: message.peerId,
      serverTime: Date.now(),
      revision: room.revision + 1,
      memberCount: room.peers.listPeers().length,
      appVersion: room.appVersion,
      protocolVersion: room.protocolVersion,
      buildNumber: room.buildNumber,
      connectionMode: room.connectionMode,
    };
    this.safeSend(socket, joinAck);
    this.broadcastSnapshot(message.roomId);
    this.sendAvatarsToPeer(socket, room.roomId);
    if (normalizedAvatar.avatarDataUrl) {
      this.broadcastAvatarUpdate(message.roomId, message.peerId);
    }
  }

  private handleLeave(message: LeaveRoomMessage): void {
    this.logger?.("peer left", { roomId: message.roomId, peerId: message.peerId });
    this.roomManager.removePeer(message.roomId, message.peerId);
    this.broadcastSnapshot(message.roomId);
  }

  private handleMemberState(message: MemberStateMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const normalizedAvatar = normalizeAvatar(message.avatarDataUrl);
    room?.peers.updateMemberState(message.peerId, {
      isMuted: message.isMuted,
      isSpeaking: message.isSpeaking,
      nickname: message.nickname,
      avatarDataUrl: normalizedAvatar.avatarDataUrl,
      avatarHash: normalizedAvatar.avatarHash,
    });
    if (!room) {
      return;
    }

    const payload: MemberStateMessage = {
      type: "member_state",
      roomId: message.roomId,
      peerId: message.peerId,
      isMuted: message.isMuted,
      isSpeaking: message.isSpeaking,
      nickname: message.nickname,
    };
    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
    if (normalizedAvatar.avatarDataUrl) {
      this.broadcastAvatarUpdate(message.roomId, message.peerId);
    }
  }

  private broadcastChatMessage(message: ChatMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room) {
      return;
    }

    const payload: ChatMessage = {
      type: "chat_message",
      roomId: message.roomId,
      peerId: message.peerId,
      nickname: message.nickname,
      content: message.content,
      createdAt: message.createdAt,
    };

    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
  }

  private broadcastAudioChunk(message: AudioChunkMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room || Date.now() - message.sentAt > 1_000) {
      return;
    }

    const payload: AudioChunkMessage = {
      type: "audio_chunk",
      roomId: message.roomId,
      peerId: message.peerId,
      sequence: message.sequence,
      sentAt: message.sentAt,
      durationMs: message.durationMs,
      sampleRate: message.sampleRate,
      channelCount: 1,
      data: message.data,
    };

    for (const peer of room.peers.listConnectedPeers()) {
      if (peer.id !== message.peerId) {
        this.safeSend(peer.socket, payload);
      }
    }
  }

  private forwardPeerSignal(
    message: PeerOfferMessage | PeerAnswerMessage | IceCandidateMessage,
  ): void {
    const room = this.roomManager.getRoom(message.roomId);
    const targetPeer = room?.peers.getPeer(message.targetPeerId);
    if (targetPeer && !targetPeer.disconnectedAt) {
      this.safeSend(targetPeer.socket, message);
    }
  }

  private broadcastSnapshot(roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      return;
    }

    room.revision += 1;
    const serverTime = Date.now();
    for (const peer of room.peers.listConnectedPeers()) {
      const payload: RoomSnapshotMessage = {
        type: "room_snapshot",
        roomId: room.roomId,
        roomName: room.roomName,
        members: room.peers.toRoomMembers(peer.id),
        revision: room.revision,
        serverTime,
        appVersion: room.appVersion,
        protocolVersion: room.protocolVersion,
        buildNumber: room.buildNumber,
        connectionMode: room.connectionMode,
      };
      this.safeSend(peer.socket, payload);
      this.emit("snapshot", payload);
    }
    this.logger?.("room snapshot broadcast", {
      roomId,
      revision: room.revision,
      memberCount: room.peers.listPeers().length,
      connectedPeerCount: room.peers.listConnectedPeers().length,
    });
  }

  private handleSnapshotRequest(socket: WebSocket, message: RequestSnapshotMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const peer = room?.peers.getPeer(message.peerId);
    if (!room || !peer || peer.socket !== socket) {
      return;
    }

    this.sendSnapshotToPeer(socket, message.roomId, message.peerId);
    this.sendAvatarsToPeer(socket, message.roomId);
    this.logger?.("room snapshot requested", {
      roomId: message.roomId,
      peerId: message.peerId,
      revision: room.revision,
    });
  }

  private sendSnapshotToPeer(socket: WebSocket, roomId: string, localPeerId: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      return;
    }

    const payload: RoomSnapshotMessage = {
      type: "room_snapshot",
      roomId: room.roomId,
      roomName: room.roomName,
      members: room.peers.toRoomMembers(localPeerId),
      revision: room.revision,
      serverTime: Date.now(),
      appVersion: room.appVersion,
      protocolVersion: room.protocolVersion,
      buildNumber: room.buildNumber,
      connectionMode: room.connectionMode,
    };
    this.safeSend(socket, payload);
    this.emit("snapshot", payload);
  }

  private sendAvatarsToPeer(socket: WebSocket, roomId: string): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      return;
    }

    for (const peer of room.peers.listPeers()) {
      if (!peer.avatarDataUrl) {
        continue;
      }
      this.safeSend(socket, {
        type: "avatar_update",
        roomId,
        peerId: peer.id,
        avatarHash: peer.avatarHash,
        avatarDataUrl: peer.avatarDataUrl,
      });
    }
  }

  private broadcastAvatarUpdate(roomId: string, peerId: string): void {
    const room = this.roomManager.getRoom(roomId);
    const member = room?.peers.getPeer(peerId);
    if (!room || !member?.avatarDataUrl) {
      return;
    }

    const payload: AvatarUpdateMessage = {
      type: "avatar_update",
      roomId,
      peerId,
      avatarHash: member.avatarHash,
      avatarDataUrl: member.avatarDataUrl,
    };
    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
  }

  private safeSend(socket: WebSocket, payload: SignalEnvelope): boolean {
    if (socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized, "utf8") > MAX_SIGNALING_PAYLOAD_BYTES) {
        this.logger?.("signaling send skipped because payload is too large", {
          type: payload.type,
          payloadBytes: Buffer.byteLength(serialized, "utf8"),
        });
        return false;
      }
      socket.send(serialized);
      return true;
    } catch (error) {
      this.logger?.("signaling send failed", {
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
