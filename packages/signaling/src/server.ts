import { EventEmitter } from "node:events";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  BUILT_IN_AVATAR_IDS,
  DEFAULT_CHANNEL_ID,
  HEARTBEAT_INTERVAL_MS,
  type BuiltInAvatarId,
  type RoomCollectionItem,
  type SceneZoneId,
  type DailyRoomReport,
} from "@private-voice/shared";
import { WebSocket, WebSocketServer } from "ws";

import type {
  AudioChunkMessage,
  AudioPathStateMessage,
  AudioResyncAckMessage,
  AudioResyncRequestMessage,
  AvatarUpdateMessage,
  ChatMessage,
  ChatRecallMessage,
  ChatHistoryMessage,
  ChannelCountsMessage,
  DailyRoomReportsMessage,
  RoomCollectionAddMessage,
  RoomCollectionRemoveMessage,
  RoomCollectionSnapshotMessage,
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
  RequestDailyRoomReportsMessage,
  ScreenFrameMessage,
  ScreenPathStateMessage,
  ScreenShareStateMessage,
  SceneReactionMessage,
  ServerChatMessage,
  SignalEnvelope,
} from "./protocol";
import { isSignalEnvelope } from "./protocol";
import { ChatHistoryStore } from "./chat-history-store";
import { RoomCollectionStore } from "./room-collection-store";
import { RoomManager } from "./room-manager";
import type { SignalingRoom } from "./room-manager";
import { SessionTokenStore } from "./session-token-store";
import { DailyRoomReportStore } from "./daily-room-report-store";

interface SignalingServerOptions {
  port?: number;
  roomName: string;
  packageVersion?: string;
  logger?: (message: string, context?: Record<string, unknown>) => void;
}

const MAX_SIGNALING_PAYLOAD_BYTES = 256 * 1024;
const CHAT_HISTORY_PAYLOAD_BUDGET_BYTES = MAX_SIGNALING_PAYLOAD_BYTES - 8 * 1024;
const ROOM_COLLECTION_PAYLOAD_BUDGET_BYTES = MAX_SIGNALING_PAYLOAD_BYTES - 8 * 1024;
const ROOM_COLLECTION_CHUNK_SIZE = 128;

function buildRoomCollectionSnapshots(
  roomId: string,
  items: RoomCollectionItem[],
): RoomCollectionSnapshotMessage[] {
  if (items.length === 0) {
    return [{ type: "room_collection_snapshot", roomId, items: [], replace: true }];
  }

  const snapshots: RoomCollectionSnapshotMessage[] = [];
  let chunk: RoomCollectionItem[] = [];

  const flush = (): void => {
    if (chunk.length === 0) return;
    snapshots.push({
      type: "room_collection_snapshot",
      roomId,
      items: chunk,
      replace: snapshots.length === 0,
    });
    chunk = [];
  };

  for (const item of items) {
    const candidate = [...chunk, item];
    const payload = JSON.stringify({
      type: "room_collection_snapshot",
      roomId,
      items: candidate,
      replace: snapshots.length === 0,
    });
    if (
      chunk.length > 0 &&
      (candidate.length > ROOM_COLLECTION_CHUNK_SIZE ||
        Buffer.byteLength(payload, "utf8") > ROOM_COLLECTION_PAYLOAD_BUDGET_BYTES)
    ) {
      flush();
    }
    chunk.push(item);
  }
  flush();
  return snapshots;
}
const MAX_AVATAR_BYTES = 128 * 1024;
const MAX_AUDIO_CHUNK_BYTES = 96 * 1024;
const MAX_SCREEN_FRAME_BYTES = 220 * 1024;
const MAX_REALTIME_SOCKET_BUFFER_BYTES = 256 * 1024;
const MAX_SOCKET_BUFFER_BYTES = 8 * 1024 * 1024;
const BACKPRESSURE_LOG_INTERVAL_MS = 5_000;
const MAX_INVALID_MESSAGES = 3;
const ICE_CONFIG_RATE_LIMIT_WINDOW_MS = 60_000;
const ICE_CONFIG_RATE_LIMIT = 30;
const MAX_GLOBAL_CONNECTIONS = Math.max(5, Number(process.env.MAX_CONNECTIONS ?? 100) || 100);
const SERVER_ONLY_MESSAGE_TYPES = new Set([
  "pong",
  "join_ack",
  "room_snapshot",
  "channel_snapshot",
  "chat_history",
  "channel_counts",
  "daily_room_reports",
  "room_collection_snapshot",
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
  chat_recall: { windowMs: 10_000, limit: 12 },
  room_collection_add: { windowMs: 10_000, limit: 6 },
  room_collection_remove: { windowMs: 10_000, limit: 10 },
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
  request_daily_room_reports: { windowMs: 10_000, limit: 6 },
};
const SEAT_ZONES: SceneZoneId[] = ["gameDesk1", "gameDesk2", "gameDesk3", "gameDesk4", "gameDesk5"];

const getOccupiedAvatarIds = (
  room: SignalingRoom | undefined,
  excludingPeerId?: string,
): Set<BuiltInAvatarId> =>
  new Set(
    room?.peers
      .listPeers()
      .filter((peer) => peer.id !== excludingPeerId && peer.avatarId)
      .map((peer) => peer.avatarId as BuiltInAvatarId) ?? [],
  );

const getAvailableAvatarIds = (
  room: SignalingRoom | undefined,
  excludingPeerId?: string,
): BuiltInAvatarId[] => {
  const occupied = getOccupiedAvatarIds(room, excludingPeerId);
  return BUILT_IN_AVATAR_IDS.filter((avatarId) => !occupied.has(avatarId));
};

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

const getSupportedTurnTransports = (): string[] => {
  const transports = new Set<string>();
  for (const value of getTurnUrls()) {
    if (value.startsWith("turns:")) {
      transports.add("tls");
      continue;
    }
    const transport = new URL(
      value.replace(/^turn:/, "http:"),
      "http://localhost",
    ).searchParams.get("transport");
    transports.add(transport === "tcp" ? "tcp" : "udp");
  }
  return [...transports];
};

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
  private readonly roomCollection: Promise<RoomCollectionStore>;
  private readonly dailyRoomReports: Promise<DailyRoomReportStore>;
  private readonly sessionTokens = new SessionTokenStore();
  private readonly iceConfigRateWindows = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly options: SignalingServerOptions) {
    super();
    this.roomName = options.roomName;
    this.logger = options.logger;
    this.chatHistory = ChatHistoryStore.create(process.env.CHAT_HISTORY_FILE, this.logger);
    this.roomCollection = RoomCollectionStore.create(
      process.env.ROOM_COLLECTION_FILE ??
        (process.env.CHAT_HISTORY_FILE
          ? `${process.env.CHAT_HISTORY_FILE}.collection.json`
          : undefined),
      this.logger,
    );
    this.dailyRoomReports = DailyRoomReportStore.create(
      process.env.DAILY_ROOM_REPORT_FILE ??
        (process.env.CHAT_HISTORY_FILE
          ? `${process.env.CHAT_HISTORY_FILE}.daily-reports.json`
          : undefined),
      this.logger,
    );
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
        const occupiedAvatarIds = [
          ...getOccupiedAvatarIds(this.roomManager.getRoom(DEFAULT_CHANNEL_ID)),
        ];
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
            occupiedAvatarIds,
            droppedRealtimeMessages: this.droppedRealtimeMessages,
            turnConfigured:
              getTurnUrls().length > 0 &&
              Boolean(
                process.env.TURN_SHARED_SECRET?.trim() ||
                (process.env.TURN_USERNAME?.trim() && process.env.TURN_CREDENTIAL?.trim()),
              ),
            supportedTurnTransports: getSupportedTurnTransports(),
            now: new Date().toISOString(),
            serverTime: Date.now(),
          }),
        );
        return;
      }

      if (request.method === "GET" && request.url?.startsWith("/ice-config")) {
        if (!this.isAuthorizedHttpRequest(request)) {
          response.writeHead(401, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        if (!this.consumeIceConfigRateLimit(request)) {
          response.writeHead(429, {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
            "retry-after": "60",
          });
          response.end(JSON.stringify({ error: "rate_limited" }));
          return;
        }

        const requestUrl = new URL(request.url, "http://localhost");
        const peerId =
          (requestUrl.searchParams.get("peerId") ?? "diagnostic-peer")
            .replace(/[^a-zA-Z0-9._-]/g, "")
            .slice(0, 64) || "diagnostic-peer";
        const iceServers = buildIceServersForPeer(peerId) ?? [];
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(
          JSON.stringify({
            iceServers,
            serverTime: Date.now(),
            turnConfigured: iceServers.length > 0,
            supportedTurnTransports: getSupportedTurnTransports(),
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
        const peer = this.roomManager.getRoom(stale.roomId)?.peers.getPeer(stale.peerId);
        this.sessionTokens.invalidate(stale.roomId, stale.peerId);
        this.roomManager.removePeer(stale.roomId, stale.peerId);
        if (peer) {
          void this.dailyRoomReports.then((store) =>
            store.recordLeave(
              stale.roomId,
              stale.peerId,
              peer.nickname,
              this.roomManager.getConnectedPeerCount(stale.roomId),
            ),
          );
        }
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
    await (await this.roomCollection).flush();
    await (await this.dailyRoomReports).flush();
    this.sessionTokens.clear();

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

  private isAuthorizedHttpRequest(request: IncomingMessage): boolean {
    const expectedToken = process.env.RELAY_ACCESS_TOKEN?.trim();
    if (!expectedToken) return true;

    try {
      const authorization = request.headers.authorization?.trim() ?? "";
      const bearerToken = authorization.toLowerCase().startsWith("bearer ")
        ? authorization.slice(7).trim()
        : "";
      const queryToken = new URL(request.url ?? "/", "http://localhost").searchParams.get("token");
      const suppliedToken = bearerToken || queryToken || "";
      const expected = Buffer.from(expectedToken, "utf8");
      const supplied = Buffer.from(suppliedToken, "utf8");
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    } catch {
      return false;
    }
  }

  private consumeIceConfigRateLimit(request: IncomingMessage): boolean {
    const now = Date.now();
    const key = request.socket.remoteAddress ?? "unknown";
    const current = this.iceConfigRateWindows.get(key);
    if (!current || now - current.startedAt >= ICE_CONFIG_RATE_LIMIT_WINDOW_MS) {
      this.iceConfigRateWindows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= ICE_CONFIG_RATE_LIMIT;
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
          this.sessionTokens.markDisconnected(roomId, peerId);
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
      case "request_daily_room_reports":
        void this.sendDailyRoomReports(socket, authoritative);
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
      case "chat_recall":
        this.recallChatMessage(authoritative);
        return;
      case "room_collection_add":
        this.addRoomCollectionItem(authoritative);
        return;
      case "room_collection_remove":
        this.removeRoomCollectionItem(authoritative);
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

    let existingRoom = this.roomManager.getRoom(message.roomId);
    const supersededProfilePeer = message.profileId
      ? existingRoom?.peers
          .listPeers()
          .find((peer) => peer.profileId === message.profileId && peer.id !== message.peerId)
      : undefined;

    // A desktop restart creates a new peer id while retaining the stable profile id.
    // Replace the old grace-period session immediately so it cannot occupy a seat,
    // reserve an avatar, or participate in the next mesh negotiation as a ghost peer.
    if (supersededProfilePeer) {
      this.sessions.delete(supersededProfilePeer.socket);
      this.roomManager.removePeer(message.roomId, supersededProfilePeer.id);
      this.sessionTokens.invalidate(message.roomId, supersededProfilePeer.id);
      try {
        supersededProfilePeer.socket.close(4001, "profile_session_replaced");
      } catch {
        // The new profile session remains authoritative if the old socket already closed.
      }
      this.logger?.("superseded stale profile session", {
        roomId: message.roomId,
        profileId: message.profileId,
        previousPeerId: supersededProfilePeer.id,
        peerId: message.peerId,
      });
      existingRoom = this.roomManager.getRoom(message.roomId);
    }

    const existingPeer = existingRoom?.peers.getPeer(message.peerId);
    let sessionToken: string;
    if (existingPeer) {
      const tokenValidation = this.sessionTokens.resume(
        message.roomId,
        message.peerId,
        message.sessionToken,
      );
      if (tokenValidation.status !== "valid") {
        this.safeSend(socket, {
          type: "error",
          code:
            tokenValidation.status === "expired"
              ? "reconnect_session_expired"
              : "reconnect_session_invalid",
          roomId: message.roomId,
          peerId: message.peerId,
          message:
            tokenValidation.status === "expired"
              ? "重连凭证已过期，请重新进入频道。"
              : "无法验证本次重连，请稍后重新进入频道。",
        });
        return;
      }
      sessionToken = tokenValidation.sessionToken;
    } else {
      sessionToken = this.sessionTokens.issue(message.roomId, message.peerId);
    }
    if (!existingPeer && !this.roomManager.canJoin(message.roomId)) {
      this.sessionTokens.invalidate(message.roomId, message.peerId);
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

    const requestedAvatarId = existingPeer?.avatarId ?? message.avatarId;
    const occupiedAvatarIds = getOccupiedAvatarIds(existingRoom, message.peerId);
    if (occupiedAvatarIds.has(requestedAvatarId)) {
      if (!existingPeer) {
        this.sessionTokens.invalidate(message.roomId, message.peerId);
      }
      const availableAvatarIds = getAvailableAvatarIds(existingRoom, message.peerId);
      this.logger?.("avatar selection rejected", {
        roomId: message.roomId,
        peerId: message.peerId,
        avatarId: requestedAvatarId,
        availableAvatarIds,
      });
      this.safeSend(socket, {
        type: "error",
        code: "avatar_taken",
        roomId: message.roomId,
        peerId: message.peerId,
        avatarId: requestedAvatarId,
        availableAvatarIds,
        message: "这个角色刚被朋友选走了，请换一个角色再进入频道。",
      });
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
      profileId: existingPeer?.profileId ?? message.profileId,
      nickname: message.nickname,
      avatarDataUrl: existingPeer?.avatarDataUrl,
      avatarHash: existingPeer?.avatarHash,
      avatarId: requestedAvatarId,
      socket,
      isHost: false,
      isMuted: existingPeer?.isMuted ?? false,
      isSpeaking: existingPeer?.isSpeaking ?? false,
      isDeafened: existingPeer?.isDeafened ?? false,
      activity:
        assignedSceneZone === "restroomZone" ? "restroom" : (existingPeer?.activity ?? "idle"),
      sceneZone: assignedSceneZone,
      gameName: existingPeer?.gameName,
      gameIconDataUrl: existingPeer?.gameIconDataUrl,
      musicActivity: existingPeer?.musicActivity,
      workActivity: existingPeer?.workActivity,
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
    if (!existingPeer) {
      void this.dailyRoomReports.then((store) =>
        store.recordJoin(
          message.roomId,
          message.peerId,
          message.nickname,
          room.peers.listConnectedPeers().length,
        ),
      );
    }

    const joinAck: JoinAckMessage = {
      type: "join_ack",
      roomId: room.roomId,
      peerId: message.peerId,
      serverTime: Date.now(),
      revision: room.revision + 1,
      memberCount: room.peers.listPeers().length,
      sessionToken,
      appVersion: room.appVersion,
      protocolVersion: room.protocolVersion,
      buildNumber: room.buildNumber,
      iceServers: buildIceServersForPeer(message.peerId),
    };
    this.safeSend(socket, joinAck);
    void this.sendChatHistory(socket, room.roomId);
    void this.sendRoomCollection(socket, room.roomId);
    this.broadcastSnapshot(message.roomId);
  }

  private handleLeave(socket: WebSocket, message: LeaveChannelMessage): void {
    this.logger?.("peer left", { roomId: message.roomId, peerId: message.peerId });
    const peer = this.roomManager.getRoom(message.roomId)?.peers.getPeer(message.peerId);
    this.roomManager.removePeer(message.roomId, message.peerId);
    if (peer) {
      void this.dailyRoomReports.then((store) =>
        store.recordLeave(
          message.roomId,
          message.peerId,
          peer.nickname,
          this.roomManager.getConnectedPeerCount(message.roomId),
        ),
      );
    }
    this.sessionTokens.invalidate(message.roomId, message.peerId);
    this.sessions.delete(socket);
    this.broadcastSnapshot(message.roomId);
  }

  private handleMemberState(message: MemberStateMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room) {
      return;
    }
    if (message.avatarId && getOccupiedAvatarIds(room, message.peerId).has(message.avatarId)) {
      const author = room.peers.getPeer(message.peerId);
      const availableAvatarIds = getAvailableAvatarIds(room, message.peerId);
      this.logger?.("avatar update rejected", {
        roomId: message.roomId,
        peerId: message.peerId,
        avatarId: message.avatarId,
        availableAvatarIds,
      });
      if (author) {
        this.safeSend(author.socket, {
          type: "error",
          code: "avatar_taken",
          roomId: message.roomId,
          peerId: message.peerId,
          avatarId: message.avatarId,
          availableAvatarIds,
          message: "这个角色已经被朋友使用，请换一个角色。",
        });
      }
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
    const normalizedGameIconDataUrl = message.gameIconDataUrl;
    const normalizedMusicActivity = message.musicActivity
      ? {
          provider: message.musicActivity.provider,
          providerName: message.musicActivity.providerName.trim().slice(0, 32),
          trackTitle: message.musicActivity.trackTitle.trim().slice(0, 160),
          artist: message.musicActivity.artist?.trim().slice(0, 100) || undefined,
        }
      : message.musicActivity === null
        ? null
        : undefined;
    const normalizedWorkActivity = message.workActivity
      ? {
          id: message.workActivity.id,
          name: message.workActivity.name.trim().slice(0, 48),
          category: message.workActivity.category,
          iconDataUrl: message.workActivity.iconDataUrl,
        }
      : message.workActivity === null
        ? null
        : undefined;
    const normalizedAvatar = normalizeAvatar(message.avatarDataUrl);
    room.peers.updateMemberState(message.peerId, {
      isMuted: message.isMuted,
      isSpeaking: message.isSpeaking,
      isDeafened: message.isDeafened,
      activity: normalizedActivity,
      sceneZone: normalizedSceneZone,
      gameName: normalizedGameName,
      gameIconDataUrl: normalizedGameIconDataUrl,
      musicActivity: normalizedMusicActivity,
      workActivity: normalizedWorkActivity,
      nickname: message.nickname,
      avatarDataUrl: normalizedAvatar.avatarDataUrl,
      avatarHash: normalizedAvatar.avatarHash,
      avatarId: message.avatarId,
    });
    void this.dailyRoomReports.then((store) =>
      store.recordGame(message.roomId, message.peerId, normalizedGameName),
    );
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
      gameIconDataUrl: normalizedGameIconDataUrl,
      musicActivity: normalizedMusicActivity,
      workActivity: normalizedWorkActivity,
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
    if (!room || !author || (!content && !message.image)) {
      return;
    }

    const storedMessage: ServerChatMessage = {
      id: randomUUID(),
      peerId: author.id,
      nickname: author.nickname,
      avatarId: author.avatarId,
      content,
      image: message.image,
      createdAt: new Date().toISOString(),
    };
    const payload: ChatMessage = {
      type: "chat_message",
      roomId: message.roomId,
      ...storedMessage,
    };

    void this.chatHistory.then((store) => store.append(message.roomId, storedMessage));
    void this.dailyRoomReports.then((store) => store.recordMessage(message.roomId));

    for (const peer of room.peers.listConnectedPeers()) {
      this.safeSend(peer.socket, payload);
    }
  }

  private async sendChatHistory(socket: WebSocket, roomId: string): Promise<void> {
    const storedMessages = (await this.chatHistory).get(roomId);
    const messages: ServerChatMessage[] = [];
    for (let index = storedMessages.length - 1; index >= 0; index -= 1) {
      const storedMessage = storedMessages[index];
      if (!storedMessage) continue;
      const candidate = [storedMessage, ...messages];
      const candidateBytes = Buffer.byteLength(
        JSON.stringify({ type: "chat_history", roomId, messages: candidate }),
        "utf8",
      );
      if (candidateBytes > CHAT_HISTORY_PAYLOAD_BUDGET_BYTES) break;
      messages.unshift(storedMessage);
    }
    const payload: ChatHistoryMessage = {
      type: "chat_history",
      roomId,
      messages,
    };
    if (messages.length < storedMessages.length) {
      this.logger?.("chat history trimmed to signaling payload budget", {
        roomId,
        sent: messages.length,
        omitted: storedMessages.length - messages.length,
      });
    }
    this.safeSend(socket, payload);
  }

  private recallChatMessage(message: ChatRecallMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const author = message.peerId ? room?.peers.getPeer(message.peerId) : undefined;
    if (!room || !author) return;

    void this.chatHistory.then((store) => {
      if (!store.remove(message.roomId, message.messageId, author.id)) return;
      const payload: ChatRecallMessage = {
        type: "chat_recall",
        roomId: message.roomId,
        peerId: author.id,
        messageId: message.messageId,
        recalledAt: new Date().toISOString(),
      };
      for (const peer of room.peers.listConnectedPeers()) {
        this.safeSend(peer.socket, payload);
      }
    });
  }

  private addRoomCollectionItem(message: RoomCollectionAddMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    const author = message.peerId ? room?.peers.getPeer(message.peerId) : undefined;
    const title = message.title?.trim().slice(0, 80);
    const content = message.content?.trim().slice(0, 2_000);
    if (!room || !author || !message.kind || !title || !content) return;

    const item: RoomCollectionItem = {
      id: randomUUID(),
      kind: message.kind,
      title,
      content,
      createdByPeerId: author.id,
      createdByNickname: author.nickname,
      createdAt: new Date().toISOString(),
    };
    void this.roomCollection.then((store) => {
      store.add(message.roomId, item);
      this.broadcastRoomCollection(message.roomId, store.get(message.roomId));
    });
  }

  private removeRoomCollectionItem(message: RoomCollectionRemoveMessage): void {
    const room = this.roomManager.getRoom(message.roomId);
    if (!room?.peers.getPeer(message.peerId ?? "")) return;
    void this.roomCollection.then(async (store) => {
      store.remove(message.roomId, message.itemId);
      this.broadcastRoomCollection(message.roomId, store.get(message.roomId));
    });
  }

  private async sendRoomCollection(socket: WebSocket, roomId: string): Promise<void> {
    const items = (await this.roomCollection).get(roomId);
    for (const payload of buildRoomCollectionSnapshots(roomId, items)) {
      this.safeSend(socket, payload);
    }
  }

  private broadcastRoomCollection(roomId: string, items: RoomCollectionItem[]): void {
    const room = this.roomManager.getRoom(roomId);
    if (!room) return;
    const payloads = buildRoomCollectionSnapshots(roomId, items);
    for (const peer of room.peers.listConnectedPeers()) {
      for (const payload of payloads) this.safeSend(peer.socket, payload);
    }
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
    void this.dailyRoomReports.then((store) =>
      store.recordScreenShare(message.roomId, message.peerId, message.isSharing),
    );

    for (const peer of room.peers.listConnectedPeers()) {
      if (peer.id !== message.peerId) {
        this.safeSend(peer.socket, payload);
      }
    }
  }

  private async sendDailyRoomReports(
    socket: WebSocket,
    message: RequestDailyRoomReportsMessage,
  ): Promise<void> {
    const reports: DailyRoomReport[] = (await this.dailyRoomReports).getHistory(
      message.targetRoomId,
    );
    const payload: DailyRoomReportsMessage = {
      type: "daily_room_reports",
      roomId: message.roomId,
      targetRoomId: message.targetRoomId,
      reports,
    };
    this.safeSend(socket, payload);
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
      this.broadcastChannelCounts();
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
    this.broadcastChannelCounts();
  }

  private broadcastChannelCounts(): void {
    const payload: ChannelCountsMessage = {
      type: "channel_counts",
      counts: {
        main: this.roomManager.getConnectedPeerCount("main"),
        side: this.roomManager.getConnectedPeerCount("side"),
      },
    };

    for (const socket of this.wss.clients) {
      if (socket.readyState === WebSocket.OPEN && this.sessions.has(socket)) {
        this.safeSend(socket, payload);
      }
    }
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
