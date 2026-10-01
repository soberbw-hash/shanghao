import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  BUILT_IN_AVATAR_IDS,
  type PrivateRoomInfo,
} from "@private-voice/shared";
import { SignalingServer } from "../../../packages/signaling/src/server";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import type { SignalEnvelope } from "../../../packages/signaling/src/protocol";
import { AccountHttpController } from "../../../packages/signaling/src/account-http-controller";
import type { IncomingMessage } from "node:http";

const backend = {
  configured: true,
  verifyAccessToken: async (token: string) => {
    if (!/^user\d$/.test(token)) throw new Error("account_session_expired");
    return { userId: token, username: token, displayName: token };
  },
} as AccountBackend;
test("public callers cannot forge TLS using a forwarded header", () => {
  const controller = new AccountHttpController(backend);
  const request = (address: string, encrypted = false) =>
    ({
      socket: { remoteAddress: address, encrypted },
      headers: { "x-forwarded-proto": "https" },
    }) as unknown as IncomingMessage;
  assert.equal(controller.isSecure(request("203.0.113.1")), false);
  assert.equal(controller.isSecure(request("127.0.0.1")), true);
  assert.equal(controller.isSecure(request("203.0.113.1", true)), true);
});

const next = (
  socket: WebSocket,
  matches: (message: SignalEnvelope) => boolean,
): Promise<SignalEnvelope> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", message);
      socket.off("error", error);
    };
    const error = (error: Error) => {
      cleanup();
      reject(error);
    };
    const message = (raw: Buffer) => {
      const data = JSON.parse(raw.toString());
      if (matches(data)) {
        cleanup();
        resolve(data);
      }
    };
    const timer = setTimeout(() => error(new Error("message_timeout")), 3_000);
    socket.on("message", message);
    socket.on("error", error);
  });

test("an older client gets the update gate before private-room lookup", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-private-version-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = new SignalingServer({
    accountBackend: backend,
    privateRoomFile: path.join(directory, "rooms.json"),
    requiredClientVersion: "3.4.0",
  });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    headers: { authorization: "Bearer user0" },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    for (const roomId of ["main", `room_${"a".repeat(32)}`]) {
      const response = next(socket, (data) => data.type === "error");
      socket.send(
        JSON.stringify({
          type: "join_channel",
          roomId,
          channelId: roomId,
          peerId: "old-client",
          nickname: "User0",
          avatarId: BUILT_IN_AVATAR_IDS[0],
          appVersion: "3.3.1",
          protocolVersion: APP_PROTOCOL_VERSION,
          buildNumber: APP_BUILD_NUMBER,
        }),
      );
      const result = await response;
      assert.equal(result.code, "CLIENT_UPDATE_REQUIRED");
      assert.equal(result.requiredVersion, "3.4.0");
      assert.equal(server.roomManager.getRoom(roomId), undefined);
    }
  } finally {
    socket.terminate();
    await server.close();
  }
});

test("private rooms isolate sessions, bound five seats, and persist moderation across restart", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-private-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = {
    roomName: "legacy fixture",
    accountBackend: backend,
    privateRoomFile: path.join(directory, "rooms.json"),
  };
  let server = new SignalingServer(options);
  let port = await server.listen();
  const sockets: WebSocket[] = [];
  const request = async (route: string, method = "GET", body?: unknown, user = "user0") => {
    const response = await fetch(`http://127.0.0.1:${port}/api/rooms${route}`, {
      method,
      headers: { authorization: `Bearer ${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() };
  };
  const join = async (room: PrivateRoomInfo, user: string, peer: string, index = 0) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { authorization: `Bearer ${user}` },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const result = next(socket, (data) => data.type === "join_ack" || data.type === "error");
    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: room.roomId,
        channelId: room.roomId,
        peerId: peer,
        profileId: "spoofed-owner",
        nickname: "spoofed",
        avatarId: BUILT_IN_AVATAR_IDS[index],
        appVersion: "3.3.1",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
      }),
    );
    return { socket, result: await result };
  };
  try {
    const a = (await request("", "POST", { channelCode: "000000", name: "深夜上号" }))
      .body as PrivateRoomInfo;
    const b = (await request("", "POST", { channelCode: "829105" }, "user1"))
      .body as PrivateRoomInfo;
    assert.equal(a.channelCode, "000000");
    assert.equal((await request("/find?code=000000")).body.roomId, a.roomId);
    assert.equal(
      (await request(`/${a.roomId}`, "PUT", { name: "wrong", icon: "moon" }, "user1")).status,
      403,
    );
    const one = await join(a, "user0", "a0");
    assert.equal(one.result.type, "join_ack");
    const other = await join(b, "user1", "b1");
    assert.equal(other.result.type, "join_ack");
    const crossRoom = next(
      one.socket,
      (data) => data.type === "error" && data.code === "room_mismatch",
    );
    one.socket.send(
      JSON.stringify({
        type: "chat_message",
        roomId: b.roomId,
        clientMessageId: "wrong-room",
        content: "must not cross",
      }),
    );
    assert.equal((await crossRoom).type, "error");
    for (let i = 1; i < 5; i++)
      assert.equal((await join(a, `user${i}`, `a${i}`, i)).result.type, "join_ack");
    assert.equal((await join(a, "user5", "a5", 0)).result.code, "room_full");
    assert.equal((await request(`/${a.roomId}`)).body.onlineCount, 5);
    assert.equal((await request(`/${b.roomId}`, "GET", undefined, "user1")).body.onlineCount, 1);
    const removed = next(
      one.socket,
      (data) => data.type === "room_snapshot" && data.members.length === 4,
    );
    assert.equal((await request(`/${a.roomId}/kick`, "POST", { peerId: "a4" })).status, 200);
    await removed;
    assert.equal((await join(a, "user5", "a5new", 4)).result.type, "join_ack");
    const ban = await request(`/${a.roomId}/ban`, "POST", {
      userId: "user5",
      displayName: "User5",
    });
    assert.equal(ban.status, 200);
    assert.equal((await join(a, "user5", "a5banned", 4)).result.code, "room_banned");
    assert.equal((await request(`/${a.roomId}/bans`, "GET", undefined, "user1")).status, 403);
    assert.equal((await request(`/${a.roomId}/unban`, "POST", { userId: "user5" })).status, 200);
    assert.equal((await join(a, "user5", "a5unbanned", 4)).result.type, "join_ack");
    const ownerLeft = next(other.socket, (data) => data.type === "pong");
    one.socket.send(JSON.stringify({ type: "leave_channel", roomId: a.roomId, peerId: "a0" }));
    other.socket.send(
      JSON.stringify({ type: "heartbeat", roomId: b.roomId, peerId: "b1", sentAt: Date.now() }),
    );
    await ownerLeft;
    assert.equal((await request(`/${a.roomId}`)).body.ownerId, "user0");
    assert.equal((await request(`/${a.roomId}`)).body.onlineCount, 4);
    assert.equal((await join(a, "user6", "a6", 0)).result.type, "join_ack");
    // Offline ownership grants moderation, never an extra sixth seat.
    assert.equal((await join(a, "user0", "owner-return", 0)).result.code, "room_full");
    assert.equal(
      (await request(`/${a.roomId}/kick`, "POST", { peerId: "a6" }, "user1")).status,
      403,
    );
    assert.equal((await request(`/${a.roomId}`, "DELETE")).status, 200);
    assert.equal((await request(`/${a.roomId}`)).status, 404);
    assert.equal((await request(`/${b.roomId}`, "GET", undefined, "user1")).status, 200);
    other.socket.send(JSON.stringify({ type: "leave_channel", roomId: b.roomId, peerId: "b1" }));
    for (let attempt = 0; attempt < 20 && server.roomManager.getRoom(b.roomId); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(server.roomManager.getRoom(b.roomId), undefined);
    assert.equal((await request(`/${b.roomId}`, "GET", undefined, "user1")).body.onlineCount, 0);
    assert.equal((await join(b, "user1", "b-again")).result.type, "join_ack");
    assert.equal(
      (
        await request(
          `/${b.roomId}/ban`,
          "POST",
          { userId: "user2", displayName: "User2" },
          "user1",
        )
      ).status,
      200,
    );
    for (const socket of sockets) socket.terminate();
    await server.close();
    server = new SignalingServer(options);
    port = await server.listen();
    const restored = await request(`/${b.roomId}`, "GET", undefined, "user1");
    assert.equal(restored.body.roomId, b.roomId);
    assert.equal(restored.body.channelCode, "829105");
    assert.equal(restored.body.ownerId, "user1");
    assert.equal(restored.body.onlineCount, 0);
    assert.equal(
      (await request(`/${b.roomId}/bans`, "GET", undefined, "user1")).body[0].userId,
      "user2",
    );
    assert.equal((await join(b, "user2", "restart-banned")).result.code, "room_banned");
    assert.equal((await request("", "POST", { channelCode: "000000" })).status, 409);
    // A single account cannot exhaust the command budget of friends behind the same NAT.
    for (let attempt = 0; attempt < 60; attempt++)
      assert.equal((await request("/mine", "GET", undefined, "user3")).status, 200);
    assert.equal((await request("/mine", "GET", undefined, "user3")).status, 429);
    assert.equal((await request("/mine", "GET", undefined, "user4")).status, 200);
  } finally {
    for (const socket of sockets) socket.terminate();
    await server.close();
  }
});
