import { EventEmitter } from "node:events";
import { createServer, type Server as HttpServer } from "node:http";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
} from "@private-voice/shared";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type {
  ErrorMessage,
  HelloMessage,
  IceCandidateMessage,
  JoinRoomMessage,
  LeaveRoomMessage,
  MemberStateMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  RoomSnapshotMessage,
  SignalEnvelope,
} from "./protocol";
import { isSignalEnvelope } from "./protocol";
import { RoomManager } from "./room-manager";

interface SignalingServerOptions {
  port?: number;
  roomName: string;
  logger?: (message: string, context?: Record<string, unknown>) => void;
}

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
      this.httpServer.listen(port, "0.0.0.0");
    });
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      try {
        const payload = JSON.parse(raw.toString()) as unknown;
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
        socket.send(JSON.stringify(message));
      }
    });

    socket.on("close", () => {
      const roomId = Reflect.get(socket, "__roomId") as string | undefined;
      const peerId = Reflect.get(socket, "__peerId") as string | undefined;

      if (roomId && peerId) {
        this.roomManager.removePeer(roomId, peerId);
        this.broadcastSnapshot(roomId);
      }
    });
  }

  private handleSignal(socket: WebSocket, message: SignalEnvelope): void {
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
      case "peer_offer":
      case "peer_answer":
      case "ice_candidate":
        this.forwardPeerSignal(message);
        return;
      case "member_state":
        this.handleMemberState(message);
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
      socket.send(JSON.stringify(mismatchMessage));
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
      socket.send(JSON.stringify(relayMessage));
      return;
    }

    if (!this.roomManager.canJoin(message.roomId)) {
      const roomFullMessage: ErrorMessage = {
        type: "error",
        code: "room_full",
        roomId: message.roomId,
        peerId: message.peerId,
        message: "房间已满，最多只能同时 5 人语音。",
      };
      socket.send(JSON.stringify(roomFullMessage));
      return;
    }

    Reflect.set(socket, "__roomId", message.roomId);
    Reflect.set(socket, "__peerId", message.peerId);
    const existingPeerCount = existingRoom?.peers.listPeers().length ?? 0;

    this.roomManager.addPeer(
      message.roomId,
      this.roomName,
      {
        id: message.peerId,
        nickname: message.nickname,
        avatarDataUrl: message.avatarDataUrl,
        socket,
        isHost: existingPeerCount === 0,
        isMuted: false,
        isSpeaking: false,
        joinedAt: new Date().toISOString(),
        lastHeartbeatAt: Date.now(),
      },
      message.connectionMode === "relay" ? message.relayToken : undefined,
    );

    this.broadcastSnapshot(message.roomId, {
      appVersion: message.appVersion,
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      connectionMode: message.connectionMode,
    });
  }

  private handleLeave(message: LeaveRoomMessage): void {
    this.roomManager.removePeer(message.roomId, message.peerId);
    this.broadcastSnapshot(message.roomId);
  }

  private handleMemberState(message: MemberStateMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    room?.peers.updateMemberState(message.peerId, {
      isMuted: message.isMuted,
      isSpeaking: message.isSpeaking,
      nickname: message.nickname,
      avatarDataUrl: message.avatarDataUrl,
    });
    this.broadcastSnapshot(message.roomId);
  }

  private forwardPeerSignal(
    message: PeerOfferMessage | PeerAnswerMessage | IceCandidateMessage,
  ): void {
    const room = this.roomManager.getRoom(message.roomId);
    const targetPeer = room?.peers.getPeer(message.targetPeerId);
    if (targetPeer) {
      targetPeer.socket.send(JSON.stringify(message));
    }
  }

  private broadcastSnapshot(
    roomId: string,
    metadata?: Pick<
      RoomSnapshotMessage,
      "appVersion" | "protocolVersion" | "buildNumber" | "connectionMode"
    >,
  ): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) {
      return;
    }

    for (const peer of room.peers.listPeers()) {
      const payload: RoomSnapshotMessage = {
        type: "room_snapshot",
        roomId: room.roomId,
        roomName: room.roomName,
        members: room.peers.toRoomMembers(peer.id),
        appVersion: metadata?.appVersion ?? "unknown",
        protocolVersion: metadata?.protocolVersion ?? APP_PROTOCOL_VERSION,
        buildNumber: metadata?.buildNumber ?? APP_BUILD_NUMBER,
        connectionMode: metadata?.connectionMode ?? "direct_host",
      };
      peer.socket.send(JSON.stringify(payload));
      this.emit("snapshot", payload);
    }
  }
}
