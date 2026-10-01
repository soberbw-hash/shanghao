import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isChannelCode,
  isPrivateRoomId,
  isRoomIconId,
  type PrivateRoomInfo,
} from "@private-voice/shared";
import type { AccountBackend } from "./account-service";
import { PrivateRoomDirectory, PrivateRoomError } from "./private-room-directory";

interface RoomRuntime {
  count: (roomId: string) => number;
  changed: (room: PrivateRoomInfo) => void;
  deleted: (roomId: string) => void;
  kick: (roomId: string, peerId: string, ownerId: string) => void;
  banned: (roomId: string, userId: string) => void;
}
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value || value.length > 128)
    throw new PrivateRoomError("room_invalid_request");
  return value;
};
const readBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const buffers: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 8_192) throw new PrivateRoomError("room_invalid_request");
    buffers.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(buffers).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return value as Record<string, unknown>;
  } catch {
    throw new PrivateRoomError("room_invalid_request");
  }
};

/** Authenticated management only. No endpoint enumerates other users' rooms. */
export class PrivateRoomHttpController {
  private readonly rates = new Map<string, { since: number; count: number }>();
  private pending = 0;
  constructor(
    private readonly directory: Promise<PrivateRoomDirectory>,
    private readonly backend: AccountBackend,
    private readonly runtime: RoomRuntime,
    private readonly secure: (request: IncomingMessage) => boolean,
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/rooms" && !url.pathname.startsWith("/api/rooms/")) return false;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-content-type-options", "nosniff");
    const send = (status: number, value: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(value));
    };
    const fail = (status: number, code: string) => send(status, { error: { code } });
    if (!this.secure(request)) {
      fail(426, "account_secure_transport_required");
      return true;
    }
    if (!this.backend.configured) {
      fail(503, "account_not_configured");
      return true;
    }
    const authorization = request.headers.authorization ?? "";
    const token = /^Bearer (.+)$/i.exec(authorization)?.[1];
    if (!token || token.length > 8_192) {
      fail(401, "account_session_expired");
      return true;
    }
    const now = Date.now();
    for (const [key, rate] of this.rates) if (now - rate.since >= 60_000) this.rates.delete(key);
    const address = request.socket.remoteAddress ?? "unknown";
    // Five friends may share one NAT. Bound unauthenticated work by IP,
    // then apply the stricter command budget to the verified account.
    const admit = (key: string, limit: number): boolean => {
      if (this.rates.size >= 10_000 && !this.rates.has(key)) return false;
      const rate = this.rates.get(key) ?? { since: now, count: 0 };
      this.rates.set(key, rate);
      return ++rate.count <= limit;
    };
    if (!admit(`ip:${address}`, 300) || this.pending >= 32) {
      fail(429, "room_rate_limited");
      return true;
    }
    this.pending++;
    try {
      const identity = await this.backend.verifyAccessToken(token);
      if (request.destroyed || response.destroyed) return true;
      if (!admit(`user:${identity.userId}`, 60)) {
        fail(429, "room_rate_limited");
        return true;
      }
      const directory = await this.directory;
      const info = (room: PrivateRoomInfo) => ({
        ...room,
        onlineCount: this.runtime.count(room.roomId),
      });
      const method = request.method;
      if (method === "GET" && url.pathname === "/api/rooms/mine") {
        send(200, directory.ownedBy(identity.userId).map(info));
        return true;
      }
      if (method === "GET" && url.pathname === "/api/rooms/random-code") {
        send(200, { channelCode: directory.randomAvailableCode() });
        return true;
      }
      if (method === "GET" && url.pathname === "/api/rooms/availability") {
        send(200, { available: directory.available(url.searchParams.get("code") ?? "") });
        return true;
      }
      if (method === "GET" && url.pathname === "/api/rooms/find") {
        const room = directory.find(url.searchParams.get("code") ?? "");
        send(200, info(directory.assertCanJoin(room.roomId, identity.userId)));
        return true;
      }
      if (method === "POST" && url.pathname === "/api/rooms") {
        const body = await readBody(request);
        if (
          (body.channelCode !== undefined && !isChannelCode(body.channelCode)) ||
          (body.icon !== undefined && !isRoomIconId(body.icon)) ||
          (body.name !== undefined && typeof body.name !== "string")
        )
          throw new PrivateRoomError("room_invalid_request");
        send(201, info(await directory.create(identity.userId, identity.displayName, body)));
        return true;
      }
      const match = /^\/api\/rooms\/(room_[a-f0-9]{32})(?:\/(bans|kick|ban|unban))?$/.exec(
        url.pathname,
      );
      const roomId = match?.[1];
      if (!roomId || !isPrivateRoomId(roomId)) {
        fail(404, "room_not_found");
        return true;
      }
      const action = match?.[2];
      if (method === "GET" && !action) {
        send(200, info(directory.assertCanJoin(roomId, identity.userId)));
        return true;
      }
      directory.assertOwner(roomId, identity.userId);
      if (method === "GET" && action === "bans") {
        send(200, directory.bans(roomId, identity.userId));
        return true;
      }
      if (method === "DELETE" && !action) {
        await directory.delete(roomId, identity.userId);
        this.runtime.deleted(roomId);
        send(200, { deleted: true });
        return true;
      }
      const body = await readBody(request);
      if (method === "PUT" && !action) {
        if (typeof body.name !== "string" || !isRoomIconId(body.icon))
          throw new PrivateRoomError("room_invalid_request");
        const room = await directory.update(identity.userId, {
          roomId,
          name: body.name,
          icon: body.icon,
        });
        this.runtime.changed(room);
        send(200, info(room));
        return true;
      }
      if (method === "POST" && action === "kick") {
        this.runtime.kick(roomId, text(body.peerId), identity.userId);
        send(200, { removed: true });
        return true;
      }
      if (method === "POST" && action === "ban") {
        const userId = text(body.userId);
        await directory.ban(roomId, identity.userId, userId, text(body.displayName));
        this.runtime.banned(roomId, userId);
        send(200, { banned: true });
        return true;
      }
      if (method === "POST" && action === "unban") {
        await directory.unban(roomId, identity.userId, text(body.userId));
        send(200, { unbanned: true });
        return true;
      }
      fail(405, "room_invalid_request");
    } catch (error) {
      if (response.destroyed) return true;
      if (error instanceof PrivateRoomError) {
        fail(
          error.code === "room_owner_required" || error.code === "room_banned"
            ? 403
            : error.code === "room_not_found"
              ? 404
              : error.code === "room_code_unavailable" || error.code === "room_limit_reached"
                ? 409
                : 400,
          error.code,
        );
      } else if (
        error instanceof Error &&
        /account_session_expired|account_invalid_credentials/.test(error.message)
      ) {
        fail(401, "account_session_expired");
      } else {
        fail(503, "room_service_unavailable");
      }
    } finally {
      this.pending--;
    }
    return true;
  }
}
