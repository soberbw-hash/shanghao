import { EventEmitter } from "node:events";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  type SceneZoneId,
} from "@private-voice/shared";
import { WebSocket, WebSocketServer } from "ws";

import type {
  AudioChunkMessage,
  AudioPathStateMessage,
  AudioResyncAckMessage,
  AudioResyncRequestMessage,
  AvatarUpdateMessage,
  ChatMessage,
  ChatHistoryMessage,
  ErrorMessage,
  IceCandidateMessage,
  JoinChannelMessage,
  JoinAckMessage,
  IceServerConfig,
  LeaveChannelMessage,
  MemberStateMessage,
  KnockEventMessage,
  PeerAnswerMessage,
  PeerOfferMessage,
  PeerRestartRequestMessage,
  ChannelSnapshotMessage,
  RoomSnapshotMessage,
  RequestSnapshotMessage,
  ScreenFrameMessage,
  ScreenPathStateMessage,
  ScreenShareStateMessage,
  SceneReactionMessage,
  ServerChatMessage,
  SignalEnvelope,
} from "./protocol";
import { isSignalEnvelope } from "./protocol";
import { ChatHistoryStore } from "./chat-history-store";
import { RoomManager } from "./room-manager";

interface SignalingServerOptions {
  port?: number;
  roomName: string;
  packageVersion?: string;
  logger?: (message: string, context?: Record<string, unknown>) => void;
}

const MAX_SIGNALING_PAYLOAD_BYTES = 256 * 1024;
const MAX_AVATAR_BYTES = 128 * 1024;
const MAX_AUDIO_CHUNK_BYTES = 96 * 1024;
const MAX_SCREEN_FRAME_BYTES = 220 * 1024;
const MAX_REALTIME_SOCKET_BUFFER_BYTES = 256 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
const BACKPRESSURE_LOG_INTERVAL_MS = 5_000;
const MAX_INVALID_MESSAGES = 3;
const MAX_GLOBAL_CONNECTIONS = Math.max(5, Number(process.env.MAX_CONNECTIONS ?? 100) || 100);
const SERVER_ONLY_MESSAGE_TYPES = new Set([
  "pong",
  "join_ack",
  "room_snapshot",
  "channel_snapshot",
  "chat_history",
  "avatar_update",
  "error",
]);

interface SocketSession {
  roomId: string;
  peerId: string;
  invalidMessages: number;
  rateWindows: Map<string, { startedAt: number; count: number }>;
}

const RATE_LIMITS: Record<string, { windowMs: number; limit: number }> = {
  chat_message: { windowMs: 10_000, limit: 8 },
  knock_event: { windowMs: 10_000, limit: 3 },
  scene_reaction: { windowMs: 10_000, limit: 12 },
  member_state: { windowMs: 10_000, limit: 40 },
  peer_offer: { windowMs: 10_000, limit: 40 },
  peer_answer: { windowMs: 10_000, limit: 40 },
  peer_restart_request: { windowMs: 10_000, limit: 20 },
  ice_candidate: { windowMs: 10_000, limit: 160 },
  audio_chunk: { windowMs: 1_000, limit: 120 },
  audio_path_state: { windowMs: 10_000, limit: 40 },
  audio_resync_request: { windowMs: 10_000, limit: 20 },
  audio_resync_ack: { windowMs: 10_000, limit: 20 },
  screen_frame: { windowMs: 1_000, limit: 24 },
  screen_share_state: { windowMs: 10_000, limit: 10 },
  screen_path_state: { windowMs: 10_000, limit: 30 },
};
const SEAT_ZONES: SceneZoneId[] = ["gameDesk1", "gameDesk2", "gameDesk3", "gameDesk4", "gameDesk5"];

const resolveSceneZone = (
  occupiedZones: Array<{ peerId: string; sceneZone?: SceneZoneId; disconnectedAt?: number }>,
  peerId: string,
  requestedZone?: SceneZoneId,
): SceneZoneId => {
  if (requestedZone && !SEAT_ZONES.includes(requestedZone)) {
    return requestedZone;
  }

  const occupiedSeats = new Set(
    occupiedZones
      .filter((peer) => peer.peerId !== peerId && !peer.disconnectedAt)
      .map((peer) => peer.sceneZone)
      .filter((zone): zone is SceneZoneId => Boolean(zone && SEAT_ZONES.includes(zone))),
  );
  if (requestedZone && !occupiedSeats.has(requestedZone)) {
    return requestedZone;
  }
  return SEAT_ZONES.find((zone) => !occupiedSeats.has(zone)) ?? "restroomZone";
};

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

const getTurnUrls = (): string[] =>
  (process.env.TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("turn:") || value.startsWith("turns:"));

const buildIceServersForPeer = (peerId: string): IceServerConfig[] | undefined => {
  const urls = getTurnUrls();
  if (urls.length === 0) return undefined;

  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim();
  if (sharedSecret) {
    const requestedTtl = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS ?? 86_400);
    const ttl = Number.isFinite(requestedTtl)
      ? Math.min(604_800, Math.max(3_600, requestedTtl))
      : 86_400;
    const username = `${Math.floor(Date.now() / 1_000) + ttl}:${peerId}`;
    return [
      {
        urls,
        username,
        credential: createHmac("sha1", sharedSecret).update(username).digest("base64"),
      },
    ];
  }

  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL?.trim();
  return username && credential ? [{ urls, username, credential }] : undefined;
};

export class SignalingServer extends EventEmitter {
  private readonly roomManager = new RoomManager();
  private readonly httpServer: HttpServer;
  private readonly wss: WebSocketServer;
  private readonly roomName: string;
  private readonly logger?: SignalingServerOptions["logger"];
  private heartbeatTimer?: NodeJS.Timeout;
  private audioServerSequence = 0;
  private droppedRealtimeMessages = 0;
  private lastBackpressureLogAt = 0;
  private readonly sessions = new WeakMap<WebSocket, SocketSession>();
  private readonly invalidMessages = new WeakMap<WebSocket, number>();
  private readonly chatHistory: Promise<ChatHistoryStore>;

  constructor(private readonly options: SignalingServerOptions) {
    super();
    this.roomName = options.roomName;
    this.logger = options.logger;
    this.chatHistory = ChatHistoryStore.create(process.env.CHAT_HISTORY_FILE, this.logger);
    this.httpServer = createServer();
    this.httpServer.on("request", (request, response) => {
      const contentLength = Number(request.headers["content-length"] ?? 0);
      if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
        response.writeHead(413, { "content-type": "text/plain; charset=utf-8" });
        response.end("Payload too large");
        request.destroy();
        return;
      }
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
            packageVersion:
              this.options.packageVersion ?? process.env.npm_package_version ?? "unknown",
            uptime: process.uptime(),
            activeRooms: stats.activeRooms,
            connectedPeers: stats.connectedPeers,
            maxRoomMembers: this.roomManager.getMaxRoomMembers(),
            currentOnlineCount: stats.connectedPeers,
            droppedRealtimeMessages: this.droppedRealtimeMessages,
            turnConfigured:
              getTurnUrls().length > 0 &&
              Boolean(
                process.env.TURN_SHARED_SECRET?.trim() ||
                (process.env.TURN_USERNAME?.trim() && process.env.TURN_CREDENTIAL?.trim()),
              ),
            now: new Date().toISOString(),
            serverTime: Date.now(),
          }),
        );
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("ShangHao signaling server");
    });
    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: MAX_SIGNALING_PAYLOAD_BYTES,
    });
    this.wss.on("connection", (socket, request) => {
      if (!this.isAuthorizedRequest(request.url)) {
        socket.close(4401, "unauthorized");
        return;
      }
      if (this.wss.clients.size > MAX_GLOBAL_CONNECTIONS) {
        socket.close(4429, "server_busy");
        return;
      }
      this.handleConnection(socket);
    });
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

    await (await this.chatHistory).flush();

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

  private isAuthorizedRequest(requestUrl?: string): boolean {
    const expectedToken = process.env.RELAY_ACCESS_TOKEN?.trim();
    if (!expectedToken) return true;

    try {
      const suppliedToken =
        new URL(requestUrl ?? "/", "ws://localhost").searchParams.get("token") ?? "";
      const expected = Buffer.from(expectedToken, "utf8");
      const supplied = Buffer.from(suppliedToken, "utf8");
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    } catch {
      return false;
    }
  }

  private rejectInvalid(socket: WebSocket, code: string, message: string): void {
    const nextCount = (this.invalidMessages.get(socket) ?? 0) + 1;
    this.invalidMessages.set(socket, nextCount);
    const session = this.sessions.get(socket);
    if (session) session.invalidMessages = nextCount;
    this.logger?.("invalid signaling message", {
      code,
      invalidMessageCount: nextCount,
      roomId: session?.roomId,
      peerId: session?.peerId,
    });
    this.safeSend(socket, { type: "error", code, message });
    if (nextCount >= MAX_INVALID_MESSAGES) socket.close(4400, "too_many_invalid_messages");
  }

  private consumeRateLimit(socket: WebSocket, session: SocketSession, type: string): boolean {
    const limit = RATE_LIMITS[type];
    if (!limit) return true;

    const now = Date.now();
    const current = session.rateWindows.get(type);
    if (!current || now - current.startedAt >= limit.windowMs) {
      session.rateWindows.set(type, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    if (current.count <= limit.limit) return true;

    this.safeSend(socket, {
      type: "error",
      code: "rate_limited",
      message: "Too many messages. Please slow down.",
    });
    if (current.count > limit.limit * 2) socket.close(4429, "rate_limited");
    return false;
  }

  private handleConnection(socket: WebSocket): void {
    socket.on("message", (raw) => {
      try {
        const payloadText = raw.toString();
        if (Buffer.byteLength(payloadText, "utf8") > MAX_SIGNALING_PAYLOAD_BYTES) {
          this.rejectInvalid(
            socket,
            "payload_too_large",
            "Signaling message exceeds the 256KB limit.",
          );
          return;
        }
        const payload = JSON.parse(payloadText) as unknown;
        if (!isSignalEnvelope(payload)) {
          this.rejectInvalid(socket, "invalid_payload", "Invalid signaling message.");
          return;
        }
        this.handleSignal(socket, payload);
      } catch (error) {
        const message: ErrorMessage = {
          type: "error",
          code: "invalid_payload",
          message: error instanceof Error ? error.message : "Unknown signaling error",
        };
        this.rejectInvalid(socket, message.code, message.message);
      }
    });

    socket.on("close", (code, reason) => {
      const session = this.sessions.get(socket);
      const roomId = session?.roomId;
      const peerId = session?.peerId;

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
    if (message.type === "join_channel") {
      if (this.sessions.has(socket)) {
        this.rejectInvalid(socket, "already_joined", "Socket has already joined a channel.");
        return;
      }
      this.handleJoin(socket, message);
      return;
    }

    if (SERVER_ONLY_MESSAGE_TYPES.has(message.type)) {
      this.rejectInvalid(
        socket,
        "server_message_not_allowed",
        "Client cannot send this message type.",
      );
      return;
    }

    const session = this.sessions.get(socket);
    if (!session) {
      this.rejectInvalid(socket, "join_required", "Join the channel before sending messages.");
      return;
    }
    if (message.roomId && message.roomId !== session.roomId) {
      this.rejectInvalid(
        socket,
        "room_mismatch",
        "Message room does not match the socket session.",
      );
      return;
    }
    if (!this.consumeRateLimit(socket, session, message.type)) return;

    const authoritative = {
      ...message,
      roomId: session.roomId,
      peerId: session.peerId,
      ...(message.type === "audio_chunk" || message.type === "screen_frame"
        ? { sourcePeerId: session.peerId }
        : {}),
    } as SignalEnvelope;
    this.roomManager.getRoom(session.roomId)?.peers.updateHeartbeat(session.peerId);

    switch (authoritative.type) {
      case "leave_channel":
        this.handleLeave(socket, authoritative);
        return;
      case "heartbeat":
        this.roomManager.getRoom(authoritative.roomId)?.peers.updateHeartbeat(authoritative.peerId);
        this.safeSend(socket, {
          type: "pong",
          roomId: authoritative.roomId,
          peerId: authoritative.peerId,
          sentAt: authoritative.sentAt ?? Date.now(),
          serverTime: Date.now(),
        });
        return;
      case "request_snapshot":
        this.handleSnapshotRequest(socket, authoritative);
        return;
      case "peer_offer":
      case "peer_answer":
      case "peer_restart_request":
      case "ice_candidate":
      case "audio_path_state":
      case "screen_path_state":
        this.forwardPeerSignal(authoritative);
        return;
      case "member_state":
        this.handleMemberState(authoritative);
        return;
      case "chat_message":
        this.broadcastChatMessage(authoritative);
        return;
      case "knock_event":
        this.broadcastKnockEvent(authoritative);
        return;
      case "audio_chunk":
        this.broadcastAudioChunk(authoritative);
        return;
      case "audio_resync_request":
      case "audio_resync_ack":
        this.forwardAudioResync(authoritative);
        return;
      case "screen_frame":
        this.broadcastScreenFrame(authoritative);
        return;
      case "screen_share_state":
        this.broadcastScreenShareState(authoritative);
        return;
      case "scene_reaction":
        this.broadcastSceneReaction(authoritative);
        return;
      default:
        return;
    }
  }

  private handleJoin(socket: WebSocket, message: JoinChannelMessage): void {
    if (message.protocolVersion !== APP_PROTOCOL_VERSION) {
      const mismatchMessage: ErrorMessage = {
        type: "error",
        code: "version_mismatch",
        roomId: message.roomId,
        peerId: message.peerId,
        message: "当前版本太旧，请更新后再进入频道。",
      };
      this.safeSend(socket, mismatchMessage);
      return;
    }

    const existingRoom = this.roomManager.getRoom(message.roomId);
    const existingPeer = existingRoom?.peers.getPeer(message.peerId);
    if (!existingPeer && !this.roomManager.canJoin(message.roomId)) {
      const roomFullMessage: ErrorMessage = {
        type: "error",
        code: "room_full",
        roomId: message.roomId,
        peerId: message.peerId,
        message: "频道满了，最多 5 人同时语音。",
      };
      this.safeSend(socket, roomFullMessage);
      return;
    }

    this.sessions.set(socket, {
      roomId: message.roomId,
      peerId: message.peerId,
      invalidMessages: 0,
      rateWindows: new Map(),
    });
    if (existingPeer && existingPeer.socket !== socket) {
      try {
        existingPeer.socket.close(4001, "peer_reconnected");
      } catch {
        // The replacement socket remains authoritative even if the old socket is already gone.
      }
    }

    const assignedSceneZone = resolveSceneZone(
      existingRoom?.peers.listPeers().map((peer) => ({
        peerId: peer.id,
        sceneZone: peer.sceneZone,
        disconnectedAt: peer.disconnectedAt,
      })) ?? [],
      message.peerId,
      existingPeer?.sceneZone,
    );
    const room = this.roomManager.addPeer(message.roomId, this.roomName, {
      id: message.peerId,
      nickname: message.nickname,
      avatarDataUrl: existingPeer?.avatarDataUrl,
      avatarHash: existingPeer?.avatarHash,
      avatarId: message.avatarId ?? existingPeer?.avatarId,
      socket,
      isHost: false,
      isMuted: existingPeer?.isMuted ?? false,
      isSpeaking: existingPeer?.isSpeaking ?? false,
      isDeafened: existingPeer?.isDeafened ?? false,
      activity:
        assignedSceneZone === "restroomZone" ? "restroom" : (existingPeer?.activity ?? "idle"),
      sceneZone: assignedSceneZone,
      gameName: existingPeer?.gameName,
      joinedAt: existingPeer?.joinedAt ?? new Date().toISOString(),
      lastHeartbeatAt: Date.now(),
      disconnectedAt: undefined,
    });

    room.appVersion = message.appVersion;
    room.protocolVersion = APP_PROTOCOL_VERSION;
    room.buildNumber = APP_BUILD_NUMBER;
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
      iceServers: buildIceServersForPeer(message.peerId),
    };
    this.safeSend(socket, joinAck);
    void this.sendChatHistory(socket, room.roomId);
    this.broadcastSnapshot(message.roomId);
  }

  private handleLeave(socket: WebSocket, message: LeaveChannelMessage): void {
    this.logger?.("peer left", { roomId: message.roomId, peerId: message.peerId });
    this.roomManager.removePeer(message.roomId, message.peerId);
    this.sessions.delete(socket);
    this.broadcastSnapshot(message.roomId);
  }

  private handleMemberState(message: MemberStateMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room) {
      return;
    }
    const normalizedSceneZone = message.sceneZone
      ? resolveSceneZone(
          room.peers.listPeers().map((peer) => ({
            peerId: peer.id,
            sceneZone: peer.sceneZone,
            disconnectedAt: peer.disconnectedAt,
          })),
          message.peerId,
          message.sceneZone,
        )
      : undefined;
    const normalizedActivity =
      normalizedSceneZone === "restroomZone" ? "restroom" : message.activity;
    const normalizedGameName = message.gameName?.trim() || undefined;
    const normalizedAvatar = normalizeAvatar(message.avatarDataUrl);
    room.peers.updateMemberState(message.peerId, {
      isMuted: message.isMuted,
      isSpeaking: message.isSpeaking,
      isDeafened: message.isDeafened,
      activity: normalizedActivity,
      sceneZone: normalizedSceneZone,
      gameName: normalizedGameName,
      nickname: message.nickname,
      avatarDataUrl: normalizedAvatar.avatarDataUrl,
      avatarHash: normalizedAvatar.avatarHash,
      avatarId: message.avatarId,
    });
    const payload: MemberStateMessage = {
      type: "member_state",
      roomId: message.roomId,
      peerId: message.peerId,
      isMuted: message.isMuted,
      isSpeaking: message.isSpeaking,
      isDeafened: message.isDeafened,
      activity: normalizedActivity,
      sceneZone: normalizedSceneZone,
      gameName: normalizedGameName,
      nickname: message.nickname,
      avatarId: message.avatarId,
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
    const author = message.peerId ? room?.peers.getPeer(message.peerId) : undefined;
    const content = message.content.trim().slice(0, 500);
    if (!room || !author || !content) {
      return;
    }

    const storedMessage: ServerChatMessage = {
      id: randomUUID(),
      peerId: author.id,
      nickname: author.nickname,
      avatarId: author.avatarId,
      content,
      createdAt: new Date().toISOString(),
    };
    const payload: ChatMessage = {
      type: "chat_message",
      roomId: message.roomId,
      ...storedMessage,
    };

    void this.chatHistory.then((store) => store.append(message.roomId, storedMessage));

    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
  }

  private async sendChatHistory(socket: WebSocket, roomId: string): Promise<void> {
    const payload: ChatHistoryMessage = {
      type: "chat_history",
      roomId,
      messages: (await this.chatHistory).get(roomId),
    };
    this.safeSend(socket, payload);
  }

  private broadcastKnockEvent(message: KnockEventMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const author = room?.peers.getPeer(message.peerId);
    if (!room || !author) {
      return;
    }

    const payload: KnockEventMessage = {
      type: "knock_event",
      roomId: message.roomId,
      peerId: author.id,
      nickname: author.nickname,
      createdAt: new Date().toISOString(),
    };

    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
  }

  private broadcastAudioChunk(message: AudioChunkMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room || Buffer.byteLength(message.data, "utf8") > MAX_AUDIO_CHUNK_BYTES) {
      return;
    }

    const payload: AudioChunkMessage = {
      type: "audio_chunk",
      roomId: message.roomId,
      peerId: message.peerId,
      sourcePeerId: message.sourcePeerId || message.peerId,
      audioSessionId: message.audioSessionId,
      audioStreamEpoch: message.audioStreamEpoch,
      audioPath: "relay",
      sequence: message.sequence,
      sentAt: message.sentAt,
      capturedAtMonotonic: message.capturedAtMonotonic,
      serverReceivedAt: Date.now(),
      serverForwardedAt: Date.now(),
      serverSequence: ++this.audioServerSequence,
      durationMs: message.durationMs,
      sampleRate: message.sampleRate,
      channelCount: 1,
      codec: message.codec ?? "pcm_s16le",
      targetPeerIds: message.targetPeerIds,
      data: message.data,
    };

    const targetPeerIds = message.targetPeerIds?.length
      ? new Set(message.targetPeerIds.slice(0, 5))
      : undefined;
    for (const peer of room.peers.listConnectedPeers()) {
      if (peer.id !== message.peerId && (!targetPeerIds || targetPeerIds.has(peer.id))) {
        this.safeSend(peer.socket, payload);
      }
    }
  }

  private forwardAudioResync(message: AudioResyncRequestMessage | AudioResyncAckMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const targetPeer = room?.peers.getPeer(message.targetPeerId);
    if (targetPeer && !targetPeer.disconnectedAt) {
      this.safeSend(targetPeer.socket, message);
      this.logger?.("audio resync forwarded", {
        roomId: message.roomId,
        type: message.type,
        peerId: message.peerId,
        targetPeerId: message.targetPeerId,
      });
    }
  }

  private broadcastScreenFrame(message: ScreenFrameMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room || Buffer.byteLength(message.data, "utf8") > MAX_SCREEN_FRAME_BYTES) {
      return;
    }

    const payload: ScreenFrameMessage = {
      type: "screen_frame",
      roomId: message.roomId,
      peerId: message.peerId,
      sourcePeerId: message.sourcePeerId || message.peerId,
      sequence: message.sequence,
      sentAt: message.sentAt,
      width: message.width,
      height: message.height,
      data: message.data,
      targetPeerIds: message.targetPeerIds,
    };

    const targetPeerIds = message.targetPeerIds ? new Set(message.targetPeerIds) : undefined;
    for (const peer of room.peers.listConnectedPeers()) {
      if (peer.id !== message.peerId && (!targetPeerIds || targetPeerIds.has(peer.id))) {
        this.safeSend(peer.socket, payload);
      }
    }
  }

  private broadcastScreenShareState(message: ScreenShareStateMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room) {
      return;
    }

    const payload: ScreenShareStateMessage = {
      type: "screen_share_state",
      roomId: message.roomId,
      peerId: message.peerId,
      isSharing: message.isSharing,
    };

    for (const peer of room.peers.listConnectedPeers()) {
      if (peer.id !== message.peerId) {
        this.safeSend(peer.socket, payload);
      }
    }
  }

  private broadcastSceneReaction(message: SceneReactionMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const allowedEmoji = new Set(["👍", "🔥", "😂", "❤️"]);
    if (!room || !allowedEmoji.has(message.emoji)) {
      return;
    }
    const payload: SceneReactionMessage = {
      ...message,
      createdAt: new Date().toISOString(),
    };
    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
  }

  private forwardPeerSignal(
    message:
      | PeerOfferMessage
      | PeerAnswerMessage
      | PeerRestartRequestMessage
      | IceCandidateMessage
      | AudioPathStateMessage
      | ScreenPathStateMessage,
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
      const payload: RoomSnapshotMessage | ChannelSnapshotMessage = {
        type: room.roomId === "main" ? "channel_snapshot" : "room_snapshot",
        roomId: room.roomId,
        roomName: room.roomName,
        members: room.peers.toRoomMembers(peer.id),
        revision: room.revision,
        serverTime,
        appVersion: room.appVersion,
        protocolVersion: room.protocolVersion,
        buildNumber: room.buildNumber,
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

    const payload: RoomSnapshotMessage | ChannelSnapshotMessage = {
      type: room.roomId === "main" ? "channel_snapshot" : "room_snapshot",
      roomId: room.roomId,
      roomName: room.roomName,
      members: room.peers.toRoomMembers(localPeerId),
      revision: room.revision,
      serverTime: Date.now(),
      appVersion: room.appVersion,
      protocolVersion: room.protocolVersion,
      buildNumber: room.buildNumber,
    };
    this.safeSend(socket, payload);
    this.emit("snapshot", payload);
  }

  private sendAvatarsToPeer(socket: WebSocket, roomId: string): void {
    if (roomId === "main") {
      return;
    }
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
      if (socket.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
        this.logger?.("closing slow signaling client", {
          bufferedAmount: socket.bufferedAmount,
          type: payload.type,
        });
        socket.close(1013, "client_backpressure");
        return false;
      }

      const isRealtimePayload = payload.type === "audio_chunk" || payload.type === "screen_frame";
      if (isRealtimePayload && socket.bufferedAmount > MAX_REALTIME_SOCKET_BUFFER_BYTES) {
        this.droppedRealtimeMessages += 1;
        const now = Date.now();
        if (now - this.lastBackpressureLogAt >= BACKPRESSURE_LOG_INTERVAL_MS) {
          this.logger?.("dropping stale realtime payload for slow client", {
            bufferedAmount: socket.bufferedAmount,
            type: payload.type,
            droppedRealtimeMessages: this.droppedRealtimeMessages,
          });
          this.lastBackpressureLogAt = now;
        }
        return false;
      }

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
