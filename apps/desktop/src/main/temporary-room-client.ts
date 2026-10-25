import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import {
  TEMPORARY_AUTH_AUDIENCE,
  type TemporaryAuthChallenge,
  type TemporaryRoomAdmission,
  type TemporaryRoomSnapshot,
} from "../../../../packages/shared/src/types/temporary-room.types";
import type {
  TemporaryRoomDescriptor,
  TemporaryRoomClientState,
  TemporaryRoomManageRequest,
} from "../../../../packages/shared/src/types/temporary-room-client.types";
import type { TemporaryIdentityStore } from "./temporary-identity-store";
import type { TemporaryRoomRoute } from "./temporary-lan-host";
import {
  openInternetRoomSocket,
  type TemporaryInternetRoute,
} from "./temporary-internet-connection";

export interface TemporaryRoomRouter {
  resolve(code?: string): Promise<TemporaryRoomRoute>;
  fallback?(error: unknown, code?: string): Promise<TemporaryRoomRoute | undefined>;
  joined?(
    route: TemporaryRoomRoute,
    room: TemporaryRoomSnapshot,
  ): Promise<void | string | undefined>;
  recover?(room: TemporaryRoomSnapshot): Promise<TemporaryRoomRoute>;
  left?(sessionId: string): void;
  onConnectivity?(listener: (sessionId: string, error?: string) => void): () => void;
}

interface Connection {
  id: string;
  url: string;
  originalUrl: string;
  certificate?: string;
  bridge?: TemporaryInternetRoute;
  warning?: string;
  openAbort?: AbortController;
  socket?: WebSocket;
  admission?: TemporaryRoomAdmission;
  reconnect?: Promise<WebSocket>;
  generation: number;
  cleanup?: NodeJS.Timeout;
}
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  socket: WebSocket;
};
export class TemporaryRoomClient {
  private readonly contexts = new Map<string, Connection>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Set<(state: TemporaryRoomClientState) => void>();
  private entering = false;
  private closed = false;
  private readonly stopConnectivity?: () => void;
  constructor(
    private readonly identity: TemporaryIdentityStore,
    private readonly endpoint: () => string,
    private readonly openSocket: (
      url: string,
      certificate?: string,
    ) => WebSocket | Promise<WebSocket> = (url, certificate) =>
      new WebSocket(url, {
        handshakeTimeout: 8000,
        ...(certificate
          ? { ca: certificate, servername: "shanghao.local", rejectUnauthorized: true }
          : {}),
      }),
    private readonly router?: TemporaryRoomRouter,
  ) {
    this.stopConnectivity = router?.onConnectivity?.((sessionId, error) => {
      for (const connection of this.contexts.values())
        if (connection.admission?.room.sessionId === sessionId) {
          connection.warning = error;
          this.publish(
            connection,
            connection.socket?.readyState === WebSocket.OPEN ? "connected" : "reconnecting",
          );
        }
    });
  }

  onState(listener: (state: TemporaryRoomClientState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish(
    connection: Connection,
    status: TemporaryRoomClientState["status"],
    error: string | undefined = connection.warning,
  ): void {
    const value = {
      contextId: connection.id,
      status,
      room: connection.admission?.room,
      ...(error ? { error } : {}),
    };
    for (const listener of this.listeners)
      try {
        listener(value);
      } catch {
        /* Observer cannot own the socket. */
      }
  }
  private createContext(route: TemporaryRoomRoute = { url: this.endpoint() }): Connection {
    if (this.closed) throw Error("temporary_client_closed");
    if (this.contexts.size > 0) throw Error("temporary_already_joined");
    const url = new URL(route.url);
    if (
      url.protocol !== "wss:" &&
      !(url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    )
      throw Error("temporary_secure_connection_required");
    url.hash = "";
    url.searchParams.set("mode", "temporary");
    if (url.username || url.password) throw Error("temporary_endpoint_invalid");
    const connection: Connection = {
      id: randomUUID(),
      url: url.toString(),
      originalUrl: url.toString(),
      certificate: route.certificate,
      bridge: route.bridge,
      generation: 0,
    };
    this.contexts.set(connection.id, connection);
    return connection;
  }
  async create(): Promise<TemporaryRoomDescriptor> {
    return this.enter();
  }
  async join(code: string): Promise<TemporaryRoomDescriptor> {
    return this.enter(code);
  }
  private async enter(code?: string): Promise<TemporaryRoomDescriptor> {
    if (this.closed) throw Error("temporary_client_closed");
    if (this.entering || this.contexts.size) throw Error("temporary_already_joined");
    this.entering = true;
    try {
      const normalized = code === undefined ? undefined : code.replace(/\s/g, "");
      if (normalized !== undefined && !/^\d{8}$/.test(normalized))
        throw Error("temporary_room_code_invalid");
      const route = (await this.router?.resolve(normalized)) ?? { url: this.endpoint() };
      try {
        return await this.enterAt(route, normalized);
      } catch (error) {
        const fallback = await this.router?.fallback?.(error, normalized);
        if (!fallback) throw error;
        return await this.enterAt(fallback, normalized);
      }
    } finally {
      this.entering = false;
    }
  }
  private async enterAt(
    route: TemporaryRoomRoute,
    code?: string,
  ): Promise<TemporaryRoomDescriptor> {
    const profile = await this.identity.getProfile();
    if (!profile) throw Error("temporary_profile_required");
    if (code !== undefined && !/^\d{8}$/.test(code.replace(/\s/g, "")))
      throw Error("temporary_room_code_invalid");
    const connection = this.createContext(route);
    try {
      const socket = await this.connect(connection);
      let sessionId: string | undefined;
      if (code !== undefined) {
        const resolved = (await this.rpc(socket, {
          command: "resolve",
          code,
          proof: await this.prove(socket),
        })) as { sessionId: string; authorityId: string; epoch: number };
        if (
          route.expected &&
          (resolved.sessionId !== route.expected.sessionId ||
            resolved.authorityId !== route.expected.authorityId ||
            resolved.epoch !== route.expected.epoch)
        )
          throw Error("temporary_lan_authority_changed");
        sessionId = resolved.sessionId;
      }
      const proof = await this.prove(socket, sessionId);
      const admission = await this.rpc(
        socket,
        code === undefined
          ? { command: "create", profile, proof }
          : { command: "join", code, profile, proof },
      );
      connection.admission = admission as TemporaryRoomAdmission;
      if (this.contexts.get(connection.id) !== connection || connection.socket !== socket)
        throw Error("temporary_connection_superseded");
      if (
        route.expected &&
        (connection.admission.room.sessionId !== route.expected.sessionId ||
          connection.admission.room.authorityId !== route.expected.authorityId ||
          connection.admission.room.epoch !== route.expected.epoch)
      )
        throw Error("temporary_lan_authority_changed");
      const warning = await this.router?.joined?.(route, connection.admission.room);
      connection.warning = warning || undefined;
      if (this.contexts.get(connection.id) !== connection || connection.socket !== socket)
        throw Error("temporary_connection_superseded");
      this.publish(connection, "connected", warning || undefined);
      return this.descriptor(connection);
    } catch (error) {
      this.release(connection.id);
      throw error;
    }
  }
  /** Authenticated bounded lookup only; no join ticket is minted or exposed. */
  async resolveAt(
    route: TemporaryRoomRoute,
    code: string,
  ): Promise<{ sessionId: string; authorityId: string; epoch: number }> {
    if (!/^\d{8}$/.test(code)) throw Error("temporary_room_code_invalid");
    const connection = this.createContext(route);
    try {
      const socket = await this.connect(connection);
      return (await this.rpc(socket, {
        command: "resolve",
        code,
        proof: await this.prove(socket),
      })) as { sessionId: string; authorityId: string; epoch: number };
    } finally {
      this.release(connection.id);
    }
  }
  private async prove(socket: WebSocket, sessionId?: string) {
    const profile = await this.identity.getProfile();
    if (!profile) throw Error("temporary_profile_required");
    const challenge = (await this.rpc(socket, {
      command: "challenge",
      publicKey: profile.publicKey,
      sessionId,
    })) as TemporaryAuthChallenge;
    return this.identity.signChallenge(challenge, { audience: TEMPORARY_AUTH_AUDIENCE, sessionId });
  }
  private async connect(connection: Connection): Promise<WebSocket> {
    if (this.contexts.get(connection.id) !== connection)
      return Promise.reject(Error("temporary_connection_superseded"));
    const generation = ++connection.generation;
    connection.openAbort?.abort();
    connection.openAbort = new AbortController();
    const socket = await (connection.bridge
      ? openInternetRoomSocket(this.identity, connection.bridge, connection.openAbort.signal)
      : this.openSocket(connection.url, connection.certificate));
    if (this.contexts.get(connection.id) !== connection || connection.generation !== generation) {
      socket.terminate();
      throw Error("temporary_connection_superseded");
    }
    return new Promise((resolve, reject) => {
      connection.socket = socket;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(Error("temporary_connection_timeout"));
      }, 8500);
      socket.once("open", () => {
        clearTimeout(timer);
        if (connection.generation !== generation) {
          socket.close();
          reject(Error("temporary_connection_superseded"));
        } else resolve(socket);
      });
      socket.once("error", () => {
        clearTimeout(timer);
        reject(Error("temporary_connection_failed"));
      });
      socket.on("message", (raw) => this.receive(connection, socket, raw.toString()));
      socket.once("close", () => {
        clearTimeout(timer);
        if (connection.socket === socket) {
          connection.socket = undefined;
          this.publish(connection, "reconnecting");
          clearTimeout(connection.cleanup);
          connection.cleanup = setTimeout(() => this.release(connection.id, true), 30_000);
          connection.cleanup.unref();
        }
        for (const [id, pending] of this.pending)
          if (pending.socket === socket) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
            pending.reject(Error("temporary_connection_closed"));
          }
        reject(Error("temporary_connection_closed"));
      });
    });
  }
  private receive(connection: Connection, socket: WebSocket, data: string): void {
    if (
      !data.startsWith('{"type":"temporary_room_') ||
      socket !== connection.socket ||
      Buffer.byteLength(data) > 256 * 1024
    )
      return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === "temporary_room_response") {
      const waiting = this.pending.get(message.requestId);
      if (!waiting || waiting.socket !== socket) return;
      this.pending.delete(message.requestId);
      clearTimeout(waiting.timer);
      if (message.ok === true && message.version === 1) waiting.resolve(message.value);
      else
        waiting.reject(
          Error(
            /^temporary_[a-z_]+$/.test(message.code) ? message.code : "temporary_request_failed",
          ),
        );
    } else if (
      message.type === "temporary_room_changed" &&
      connection.admission &&
      message.roomId === connection.admission.room.sessionId
    ) {
      if (!message.room) {
        this.release(connection.id, true);
        return;
      }
      const old = connection.admission.room;
      const room = message.room as TemporaryRoomSnapshot;
      if (
        room.sessionId === old.sessionId &&
        room.authorityId === old.authorityId &&
        (room.epoch > old.epoch || (room.epoch === old.epoch && room.revision >= old.revision))
      ) {
        connection.admission = { ...connection.admission, room };
        this.publish(connection, "connected");
      }
    }
  }
  private rpc(socket: WebSocket, data: Record<string, unknown>): Promise<unknown> {
    if (socket.readyState !== WebSocket.OPEN)
      return Promise.reject(Error("temporary_connection_closed"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(Error("temporary_request_timeout"));
      }, 8000);
      this.pending.set(requestId, { resolve, reject, timer, socket });
      socket.send(
        JSON.stringify({ type: "temporary_room_request", version: 1, requestId, ...data }),
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(requestId);
            reject(Error("temporary_connection_closed"));
          }
        },
      );
    });
  }
  private descriptor(connection: Connection): TemporaryRoomDescriptor {
    const admission = connection.admission;
    if (!admission) throw Error("temporary_join_required");
    const url = new URL(connection.url);
    url.hash = `temporary=${connection.id}`;
    return {
      contextId: connection.id,
      signalingUrl: url.toString(),
      roomId: admission.room.sessionId,
      peerId: admission.member.memberId,
      nickname: admission.member.profile.nickname,
      avatarId: admission.member.profile.avatarId,
      avatarDataUrl: admission.member.profile.avatarDataUrl,
      connectionWarning: connection.warning,
      room: admission.room,
      roomName: `临时联机 · ${admission.room.code.slice(0, 4)} ${admission.room.code.slice(4)}`,
    };
  }
  /** Called only by Main's signaling bridge. Tickets stay here across transport recovery. */
  async acquire(signalingUrl: string): Promise<WebSocket | undefined> {
    const url = new URL(signalingUrl);
    if (!url.hash.startsWith("#temporary=")) return undefined;
    const id = url.hash.slice(11);
    url.hash = "";
    const connection = this.contexts.get(id);
    if (!connection?.admission || url.toString() !== connection.originalUrl)
      throw Error("temporary_context_invalid");
    clearTimeout(connection.cleanup);
    if (connection.socket?.readyState === WebSocket.OPEN) return connection.socket;
    if (!connection.reconnect)
      connection.reconnect = (async () => {
        let socket: WebSocket;
        let migration: TemporaryRoomRoute | undefined;
        try {
          socket = await this.connect(connection);
        } catch (error) {
          if (!this.router?.recover) throw error;
          migration = await this.router.recover(connection.admission!.room);
          const target = new URL(migration.url);
          target.searchParams.set("mode", "temporary");
          connection.url = target.toString();
          connection.certificate = migration.certificate;
          connection.bridge = migration.bridge;
          socket = await this.connect(connection);
        }
        try {
          const requestAdmission = async () =>
            this.rpc(socket, {
              ...(migration
                ? {
                    command: "recover",
                    sessionId: connection.admission!.room.sessionId,
                    memberId: connection.admission!.member.memberId,
                    epoch: migration.expected!.epoch,
                  }
                : { command: "resume", ticket: connection.admission!.ticket }),
              proof: await this.prove(socket, connection.admission!.room.sessionId),
            });
          let admission: unknown;
          try {
            admission = await requestAdmission();
          } catch (error) {
            if (
              migration ||
              !this.router?.recover ||
              !/^Error: temporary_authority_(lease_expired|fenced)$/.test(String(error))
            )
              throw error;
            socket.terminate();
            migration = await this.router.recover(connection.admission!.room);
            const target = new URL(migration.url);
            target.searchParams.set("mode", "temporary");
            connection.url = target.toString();
            connection.certificate = migration.certificate;
            connection.bridge = migration.bridge;
            socket = await this.connect(connection);
            admission = await requestAdmission();
          }
          if (this.contexts.get(id) !== connection || connection.socket !== socket)
            throw Error("temporary_connection_superseded");
          const next = admission as TemporaryRoomAdmission;
          if (
            next.room.sessionId !== connection.admission!.room.sessionId ||
            next.member.memberId !== connection.admission!.member.memberId ||
            (migration &&
              (next.room.authorityId !== migration.expected?.authorityId ||
                next.room.epoch !== migration.expected?.epoch))
          )
            throw Error("temporary_replica_migration_invalid");
          connection.admission = admission as TemporaryRoomAdmission;
          if (migration)
            connection.warning =
              (await this.router?.joined?.(migration, connection.admission.room)) || undefined;
          this.publish(connection, "connected");
          return socket;
        } catch (error) {
          socket.terminate();
          throw error;
        }
      })().finally(() => {
        connection.reconnect = undefined;
      });
    return connection.reconnect;
  }
  async manage(request: TemporaryRoomManageRequest): Promise<TemporaryRoomSnapshot> {
    const connection = this.contexts.get(request.contextId);
    if (!connection?.socket) throw Error("temporary_join_required");
    const value = await this.rpc(connection.socket, {
      command: request.action,
      expected: request.expected,
      ...(request.action === "lock"
        ? { locked: request.locked }
        : request.action === "kick"
          ? { memberId: request.memberId }
          : {}),
    });
    return value as TemporaryRoomSnapshot;
  }
  release(id: string, notify = false): void {
    const connection = this.contexts.get(id);
    if (!connection) return;
    this.contexts.delete(id);
    if (connection.admission) this.router?.left?.(connection.admission.room.sessionId);
    clearTimeout(connection.cleanup);
    connection.generation++;
    connection.openAbort?.abort();
    const socket = connection.socket;
    connection.socket = undefined;
    if (socket?.readyState === WebSocket.OPEN) {
      const payload = {
        type: "temporary_room_request",
        version: 1,
        requestId: randomUUID(),
        command: "leave",
      };
      socket.send(JSON.stringify(payload), () => socket.close());
      const timeout = setTimeout(() => socket.terminate(), 500);
      timeout.unref();
      socket.once("close", () => clearTimeout(timeout));
    } else socket?.terminate();
    if (notify) this.publish(connection, "ended");
  }
  close(): void {
    this.closed = true;
    this.stopConnectivity?.();
    for (const id of this.contexts.keys()) this.release(id);
  }
}
