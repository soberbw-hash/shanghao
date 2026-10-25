import { WebSocket } from "ws";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isTemporaryRoomSessionId,
  type TemporaryAuthProof,
  type TemporaryRoomAdmission,
  type TemporaryRoomProfile,
  type TemporaryRoomVersion,
  type TemporaryMemberTicket,
} from "../../shared/src/types/temporary-room.types";
import { TemporaryRoomAuthenticator, type VerifiedTemporaryPrincipal } from "./temporary-room-auth";
import { TemporaryRoomCoordinator } from "./temporary-room-coordinator";
import { TemporaryInternetBroker } from "./temporary-internet-broker";
import { TemporaryCodeAttempts, type TemporaryCodeAttemptOptions } from "./temporary-code-attempts";
import type { RoomManager } from "./room-manager";
import type { JoinChannelMessage, SignalEnvelope } from "./protocol";
import { ChatHistoryStore } from "./chat-history-store";
import { RoomCollectionStore } from "./room-collection-store";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("temporary_request_invalid");
  return value as Record<string, unknown>;
};
const text = (value: unknown, max = 128): string => {
  if (typeof value !== "string" || !value || value.length > max)
    throw Error("temporary_request_invalid");
  return value;
};
const version = (value: unknown): TemporaryRoomVersion => {
  const data = object(value);
  if (
    !Number.isSafeInteger(data.epoch) ||
    !Number.isSafeInteger(data.revision) ||
    Number(data.epoch) < 1 ||
    Number(data.revision) < 0
  )
    throw Error("temporary_version_invalid");
  return { epoch: Number(data.epoch), revision: Number(data.revision) };
};
const proof = (value: unknown): TemporaryAuthProof => {
  const data = object(value);
  return {
    challengeId: text(data.challengeId),
    publicKey: text(data.publicKey, 2048),
    signature: text(data.signature, 1024),
  };
};
const ticket = (value: unknown): TemporaryMemberTicket => {
  const data = object(value);
  if (
    !isTemporaryRoomSessionId(data.sessionId) ||
    !Number.isSafeInteger(data.generation) ||
    Number(data.generation) < 1
  )
    throw Error("temporary_ticket_invalid");
  return {
    sessionId: data.sessionId,
    memberId: text(data.memberId),
    token: text(data.token),
    generation: Number(data.generation),
  };
};

/** Device proof and lifecycle for the existing media server. No permanent persistence is reachable here. */
export class TemporaryRoomRuntime {
  readonly coordinator: TemporaryRoomCoordinator;
  private readonly internet?: TemporaryInternetBroker;
  private readonly authenticator: TemporaryRoomAuthenticator;
  private readonly codeAttempts: TemporaryCodeAttempts;
  private readonly bindings = new Map<WebSocket, TemporaryRoomAdmission>();
  private readonly endpoints = new WeakSet<WebSocket>();
  private readonly rates = new Map<string, { at: number; count: number }>();
  private readonly stores = new Map<
    string,
    { history: Promise<ChatHistoryStore>; collection: Promise<RoomCollectionStore> }
  >();
  private readonly revisions = new Map<string, number>();
  constructor(
    private readonly host: {
      evict: (roomId: string, memberId: string) => void;
      changed?: (
        roomId: string,
        room?: import("../../shared/src/types/temporary-room.types").TemporaryRoomSnapshot,
      ) => void;
      authorityId?: string;
      creatorDeviceId?: string;
      now?: () => number;
      replicaRequest?: (
        principal: VerifiedTemporaryPrincipal,
        value: unknown,
        address: string,
      ) => Promise<unknown>;
      commit?: (sessionId: string) => Promise<void>;
      directoryFile?: string;
      codeAttemptOptions?: TemporaryCodeAttemptOptions;
    },
  ) {
    this.authenticator = new TemporaryRoomAuthenticator({ now: host.now });
    this.codeAttempts = new TemporaryCodeAttempts(host.now, host.codeAttemptOptions);
    this.coordinator = new TemporaryRoomCoordinator({
      authorityId: host.authorityId,
      now: host.now,
      codeIsAvailable: (code) => !this.internet?.hasCode(code),
    });
    if (!host.creatorDeviceId)
      this.internet = new TemporaryInternetBroker(
        (code) => {
          try {
            this.coordinator.resolveCode(code);
            return true;
          } catch {
            return false;
          }
        },
        host.now ?? Date.now,
        host.directoryFile ? `${host.directoryFile}.temporary-internet.json` : undefined,
        this.codeAttempts,
      );
  }

  markEndpoint(socket: WebSocket, url?: URL, address = "unknown"): void {
    this.endpoints.add(socket);
    if (url?.pathname === "/temporary-bridge") this.internet?.attach(socket, address);
  }
  isBridge(socket: WebSocket): boolean {
    return this.internet?.owns(socket) === true;
  }
  async flush(): Promise<void> {
    await this.internet?.flush();
  }
  serveHttp(request: IncomingMessage, response: ServerResponse): void {
    response.writeHead(request.url === "/health" ? 200 : 404, {
      "content-type": "application/json",
    });
    response.end(JSON.stringify({ ok: request.url === "/health", temporary: true }));
  }
  isEndpoint(socket: WebSocket): boolean {
    return this.endpoints.has(socket);
  }
  acceptsUrl(url: URL): boolean {
    return (
      (Boolean(this.internet) && url.pathname === "/temporary-bridge") ||
      url.pathname === "/temporary" ||
      url.searchParams.get("mode") === "temporary"
    );
  }
  /** Private state has its own bound and never enters the ordinary media message parser. */
  handlePrivateReplica(socket: WebSocket, text: string, address: string): boolean {
    if (
      !this.isEndpoint(socket) ||
      Buffer.byteLength(text) > 2 * 1024 * 1024 ||
      !text.startsWith('{"type":"temporary_room_request"')
    )
      return false;
    const data = JSON.parse(text) as { purpose?: unknown; command?: unknown };
    if (data.purpose !== "replica" || data.command !== "replica") return false;
    this.handle(socket, data, address);
    return true;
  }
  admission(socket: WebSocket): TemporaryRoomAdmission | undefined {
    const value = this.bindings.get(socket);
    if (!value) return undefined;
    return {
      ...value,
      member: this.coordinator.authenticate(value.ticket),
      room: this.coordinator.snapshot(value.room.sessionId),
    };
  }
  authorizeMediaJoin(
    socket: WebSocket,
    message: JoinChannelMessage,
  ): TemporaryRoomAdmission | undefined {
    const temporary = isTemporaryRoomSessionId(message.roomId);
    const admission = temporary ? this.admission(socket) : undefined;
    if (
      (temporary &&
        (!admission ||
          admission.room.sessionId !== message.roomId ||
          admission.member.memberId !== message.peerId)) ||
      (this.isEndpoint(socket) && !temporary)
    )
      throw Error("temporary_membership_required");
    return admission;
  }
  authorizeMediaSignal(
    socket: WebSocket,
    session: { roomId: string; peerId: string },
    message: SignalEnvelope,
    send: (value: SignalEnvelope) => void,
  ): boolean {
    if (!isTemporaryRoomSessionId(session.roomId)) return true;
    try {
      this.heartbeat(socket);
    } catch {
      this.host.evict(session.roomId, session.peerId);
      return false;
    }
    if (
      ["cloud_ai_request", "request_daily_room_reports", "publish_recording_recap"].includes(
        message.type,
      )
    ) {
      send({
        type: "error",
        roomId: session.roomId,
        code: "temporary_cloud_storage_unavailable",
        message: "临时房间不保存云端历史，录音与摘要保留在本机。",
      });
      return false;
    }
    return true;
  }
  synchronizeMedia(roomManager: RoomManager, roomId: string): void {
    const room = roomManager.getRoom(roomId);
    if (!room) return;
    let snapshot;
    try {
      snapshot = this.coordinator.snapshot(roomId);
    } catch {
      /* Expired room. */
    }
    for (const peer of room.peers.listPeers()) {
      if (!snapshot?.members.some((member) => member.memberId === peer.id))
        this.host.evict(roomId, peer.id);
      else peer.isHost = snapshot.adminMemberId === peer.id;
    }
    if (snapshot)
      room.roomName = `临时联机 · ${snapshot.code.slice(0, 4)} ${snapshot.code.slice(4)}`;
  }
  history(roomId: string, permanent?: Promise<ChatHistoryStore>): Promise<ChatHistoryStore> {
    if (!isTemporaryRoomSessionId(roomId) && permanent) return permanent;
    return this.memory(roomId).history;
  }
  collection(
    roomId: string,
    permanent?: Promise<RoomCollectionStore>,
  ): Promise<RoomCollectionStore> {
    if (!isTemporaryRoomSessionId(roomId) && permanent) return permanent;
    return this.memory(roomId).collection;
  }
  private memory(roomId: string) {
    this.coordinator.snapshot(roomId);
    let store = this.stores.get(roomId);
    if (!store) {
      store = { history: ChatHistoryStore.create(), collection: RoomCollectionStore.create() };
      this.stores.set(roomId, store);
    }
    return store;
  }
  private send(socket: WebSocket, payload: unknown): void {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 512 * 1024)
      socket.send(JSON.stringify(payload));
  }
  private consume(address: string, replica = false): void {
    const now = this.host.now?.() ?? Date.now();
    for (const [key, rate] of this.rates) if (now - rate.at >= 60_000) this.rates.delete(key);
    if (!this.rates.has(address) && this.rates.size >= 4096) throw Error("temporary_rate_limited");
    const key = replica ? address + ":replica" : address;
    const rate = this.rates.get(key) ?? { at: now, count: 0 };
    this.rates.set(key, rate);
    if (++rate.count > (replica ? 1200 : 60)) throw Error("temporary_rate_limited");
  }
  handle(socket: WebSocket, payload: unknown, address: string): boolean {
    if (
      !payload ||
      typeof payload !== "object" ||
      (payload as { type?: unknown }).type !== "temporary_room_request"
    )
      return false;
    let requestId = "invalid";
    try {
      if (!this.isEndpoint(socket)) throw Error("temporary_endpoint_required");
      const data = object(payload);
      this.consume(address, data.purpose === "replica");
      requestId = text(data.requestId);
      if (!/^[A-Za-z0-9:_-]+$/.test(requestId) || data.version !== 1)
        throw Error("temporary_protocol_mismatch");
      if (data.command === "replica") {
        if (!this.host.replicaRequest) throw Error("temporary_replication_unavailable");
        const principal = this.authenticator.verify(proof(data.proof));
        const respond = (value: unknown, error?: unknown) =>
          this.send(socket, {
            type: "temporary_room_response",
            version: 1,
            requestId,
            ok: !error,
            ...(error
              ? {
                  code:
                    error instanceof Error && /^temporary_[a-z_]+$/.test(error.message)
                      ? error.message
                      : "temporary_replication_failed",
                }
              : { value }),
          });
        void this.host.replicaRequest(principal, data.value, address).then(
          (value) => respond(value),
          (error) => respond(undefined, error),
        );
        return true;
      }
      const previousSession = this.bindings.get(socket)?.room.sessionId;
      const value = this.execute(socket, data, address);
      const changedSession =
        (value as TemporaryRoomAdmission | undefined)?.room?.sessionId ?? previousSession;
      if (
        this.host.commit &&
        changedSession &&
        ["create", "join", "resume", "recover", "leave", "lock", "rotate", "kick"].includes(
          String(data.command),
        )
      ) {
        void this.host.commit(changedSession).then(
          () =>
            this.send(socket, {
              type: "temporary_room_response",
              version: 1,
              requestId,
              ok: true,
              value: this.committedValue(value, changedSession),
            }),
          (error) =>
            this.send(socket, {
              type: "temporary_room_response",
              version: 1,
              requestId,
              ok: false,
              code:
                error instanceof Error && /^temporary_[a-z_]+$/.test(error.message)
                  ? error.message
                  : "temporary_replication_failed",
            }),
        );
        return true;
      }
      this.send(socket, {
        type: "temporary_room_response",
        version: 1,
        requestId,
        ok: true,
        value,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "temporary_request_failed";
      this.send(socket, {
        type: "temporary_room_response",
        version: 1,
        requestId,
        ok: false,
        code: /^temporary_[a-z_]+$/.test(message) ? message : "temporary_request_failed",
      });
    }
    return true;
  }
  private execute(socket: WebSocket, data: Record<string, unknown>, address: string): unknown {
    if (data.command === "challenge")
      return this.authenticator.issueChallenge({
        publicKey: text(data.publicKey, 2048),
        sessionId: data.sessionId === undefined ? undefined : text(data.sessionId),
      });
    if (data.command === "resolve") {
      const principal = this.authenticator.verify(proof(data.proof));
      return this.codeAttempts.attempt(principal.deviceId, address, () =>
        this.coordinator.resolveCode(text(data.code, 64)),
      );
    }
    if (["create", "join", "resume", "recover"].includes(String(data.command))) {
      if (this.bindings.has(socket)) throw Error("temporary_already_joined");
      const principal = this.authenticator.verify(proof(data.proof));
      if (
        data.command === "create" &&
        this.host.creatorDeviceId &&
        principal.deviceId !== this.host.creatorDeviceId
      )
        throw Error("temporary_creator_not_allowed");
      const admission =
        data.command === "create"
          ? this.coordinator.create(principal, data.profile as TemporaryRoomProfile)
          : data.command === "join"
            ? this.codeAttempts.attempt(principal.deviceId, address, () =>
                this.coordinator.join(
                  text(data.code, 64),
                  principal,
                  data.profile as TemporaryRoomProfile,
                ),
              )
            : data.command === "recover"
              ? this.coordinator.recoverMember(
                  text(data.sessionId),
                  text(data.memberId),
                  principal,
                  version({ epoch: data.epoch, revision: 0 }).epoch,
                )
              : this.coordinator.resume(ticket(data.ticket), principal);
      this.bindings.set(socket, admission);
      // Replacing a reconnect ticket also invalidates an older connection for the same member.
      for (const [other, old] of this.bindings)
        if (
          other !== socket &&
          old.ticket.sessionId === admission.ticket.sessionId &&
          old.ticket.memberId === admission.ticket.memberId
        ) {
          this.bindings.delete(other);
          other.close(4001, "temporary_session_replaced");
        }
      this.changed(admission.room.sessionId);
      return admission;
    }
    const bound = this.admission(socket);
    if (!bound) throw Error("temporary_join_required");
    const id = bound.room.sessionId;
    switch (data.command) {
      case "heartbeat":
        this.coordinator.heartbeat(bound.ticket);
        return { alive: true };
      case "snapshot":
        return this.coordinator.snapshot(id);
      case "leave":
        this.leave(socket);
        return { ended: true };
      case "lock":
        if (typeof data.locked !== "boolean") throw Error("temporary_request_invalid");
        this.coordinator.setLocked(bound.ticket, data.locked, version(data.expected));
        break;
      case "rotate":
        this.coordinator.rotateCode(bound.ticket, version(data.expected));
        break;
      case "kick": {
        const memberId = text(data.memberId);
        this.coordinator.kick(bound.ticket, memberId, version(data.expected));
        for (const [other, value] of this.bindings)
          if (value.ticket.sessionId === id && value.ticket.memberId === memberId) {
            this.bindings.delete(other);
            this.host.evict(id, memberId);
            other.close(4003, "temporary_member_removed");
          }
        break;
      }
      default:
        throw Error("temporary_command_invalid");
    }
    this.changed(id);
    return this.coordinator.snapshot(id);
  }
  heartbeat(socket: WebSocket): void {
    const bound = this.bindings.get(socket);
    if (!bound) throw Error("temporary_join_required");
    this.coordinator.heartbeat(bound.ticket);
  }
  leave(socket: WebSocket, evict = true): void {
    const bound = this.bindings.get(socket);
    if (!bound) return;
    this.bindings.delete(socket);
    this.coordinator.leave(bound.ticket);
    if (evict) this.host.evict(bound.ticket.sessionId, bound.ticket.memberId);
    this.changed(bound.ticket.sessionId);
  }
  disconnect(socket: WebSocket): void {
    const bound = this.bindings.get(socket);
    if (!bound) return;
    this.bindings.delete(socket);
    try {
      this.coordinator.disconnect(bound.ticket);
      this.changed(bound.ticket.sessionId);
    } catch {
      /* An old rotated ticket cannot disconnect the replacement. */
    }
  }
  sweep(): void {
    this.codeAttempts.sweep();
    this.internet?.sweep();
    this.authenticator.sweep();
    this.coordinator.sweep();
    for (const [socket, bound] of this.bindings) {
      try {
        this.coordinator.authenticate(bound.ticket);
      } catch {
        this.bindings.delete(socket);
        this.host.evict(bound.ticket.sessionId, bound.ticket.memberId);
        socket.close(4003, "temporary_room_ended");
      }
    }
    for (const id of this.stores.keys())
      try {
        this.coordinator.snapshot(id);
      } catch {
        this.stores.delete(id);
      }
    for (const [id, revision] of this.revisions) {
      try {
        if (this.coordinator.snapshot(id).revision !== revision) this.changed(id);
      } catch {
        this.changed(id);
      }
    }
  }
  changed(roomId: string): void {
    let room;
    try {
      room = this.coordinator.snapshot(roomId);
      this.revisions.set(roomId, room.revision);
    } catch {
      this.stores.delete(roomId);
      this.revisions.delete(roomId);
    }
    for (const [socket, bound] of this.bindings)
      if (bound.room.sessionId === roomId)
        this.send(socket, {
          type: "temporary_room_changed",
          version: 1,
          roomId,
          room: room ?? null,
        });
    this.host.changed?.(roomId, room);
  }
  private committedValue(value: unknown, sessionId: string): unknown {
    if (value && typeof value === "object") {
      if ("ticket" in value) return { ...value, room: this.coordinator.snapshot(sessionId) };
      if ("kind" in value && value.kind === "temporary")
        return this.coordinator.snapshot(sessionId);
    }
    return value;
  }
}
