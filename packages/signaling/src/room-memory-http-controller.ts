import type { IncomingMessage, ServerResponse } from "node:http";
import type { SaveRoomMemoryRequest } from "@private-voice/shared";
import type { AccountBackend } from "./account-service";
import { PrivateRoomDirectory, PrivateRoomError } from "./private-room-directory";
import { RoomMemoryError, RoomMemoryStore } from "./room-memory-store";

/** Owners edit; only the owner or a currently joined, non-banned member may read. */
export class RoomMemoryHttpController {
  private pending = 0;
  private readonly rates = new Map<string, { since: number; count: number }>();
  constructor(
    private readonly directory: Promise<PrivateRoomDirectory>,
    private readonly memories: Promise<RoomMemoryStore>,
    private readonly accounts: AccountBackend,
    private readonly joined: (roomId: string, userId: string) => boolean,
    private readonly secure: (request: IncomingMessage) => boolean,
  ) {}
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const match = /^\/api\/rooms\/(room_[a-f0-9]{32})\/memory$/.exec(
      new URL(request.url ?? "/", "http://localhost").pathname,
    );
    if (!match) return false;
    const roomId = match[1]!;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const send = (status: number, value: unknown) => {
      if (!response.destroyed) {
        response.writeHead(status);
        response.end(JSON.stringify(value));
      }
    };
    const fail = (status: number, code: string) => send(status, { error: { code } });
    if (!this.secure(request)) {
      fail(426, "account_secure_transport_required");
      return true;
    }
    if (!this.accounts.configured) {
      fail(503, "account_not_configured");
      return true;
    }
    const token = /^Bearer (.+)$/i.exec(request.headers.authorization ?? "")?.[1];
    if (!token || token.length > 8192) {
      fail(401, "account_session_expired");
      return true;
    }
    const admit = (key: string, limit: number) => {
      const now = Date.now();
      for (const [id, rate] of this.rates) if (now - rate.since >= 60000) this.rates.delete(id);
      if (this.rates.size >= 10000 && !this.rates.has(key)) return false;
      const rate = this.rates.get(key) ?? { since: now, count: 0 };
      this.rates.set(key, rate);
      return ++rate.count <= limit;
    };
    if (this.pending >= 16 || !admit(`ip:${request.socket.remoteAddress}`, 300)) {
      fail(429, "room_rate_limited");
      return true;
    }
    this.pending++;
    try {
      const identity = await this.accounts.verifyAccessToken(token);
      if (request.destroyed || response.destroyed) return true;
      if (!admit(`user:${identity.userId}`, 60)) {
        fail(429, "room_rate_limited");
        return true;
      }
      const directory = await this.directory;
      const room = directory.assertCanJoin(roomId, identity.userId);
      if (request.method === "GET") {
        if (room.ownerId !== identity.userId && !this.joined(roomId, identity.userId)) {
          fail(403, "room_memory_access_denied");
          return true;
        }
        const store = await this.memories;
        directory.assertCanJoin(roomId, identity.userId);
        if (room.ownerId !== identity.userId && !this.joined(roomId, identity.userId)) {
          fail(403, "room_memory_access_denied");
          return true;
        }
        send(200, store.get(roomId));
        return true;
      }
      directory.assertOwner(roomId, identity.userId);
      if (request.method !== "PUT") {
        fail(405, "room_invalid_request");
        return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 65536) throw new RoomMemoryError("room_memory_invalid");
        chunks.push(buffer);
      }
      let body: SaveRoomMemoryRequest;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new RoomMemoryError("room_memory_invalid");
      }
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new RoomMemoryError("room_memory_invalid");
      // Recheck ownership after the body; URL identity is never supplied by the client body.
      const store = await this.memories;
      directory.assertOwner(roomId, identity.userId);
      send(200, await store.save({ ...body, roomId }));
    } catch (error) {
      if (error instanceof PrivateRoomError)
        fail(error.code === "room_not_found" ? 404 : 403, error.code);
      else if (error instanceof RoomMemoryError)
        fail(error.message === "room_memory_conflict" ? 409 : 400, error.message);
      else if (
        error instanceof Error &&
        /account_session_expired|account_invalid_credentials/.test(error.message)
      )
        fail(401, "account_session_expired");
      else fail(503, "room_memory_unavailable");
    } finally {
      this.pending--;
    }
    return true;
  }
}
