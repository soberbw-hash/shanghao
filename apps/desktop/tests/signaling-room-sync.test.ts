import assert from "node:assert/strict";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";
import { WebSocket } from "ws";

const waitForMessage = <T>(socket: WebSocket, matcher: (payload: unknown) => payload is T) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);

    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString()) as unknown;
      if (matcher(payload)) {
        clearTimeout(timer);
        resolve(payload);
      }
    });
    socket.on("error", reject);
  });

test("signaling server syncs room members after join", async () => {
  const server = new SignalingServer({ roomName: "测试房间" });
  const port = await server.listen();

  const url = `ws://127.0.0.1:${port}`;
  const hostSocket = new WebSocket(url);
  const peerSocket = new WebSocket(url);

  await Promise.all([
    new Promise((resolve) => hostSocket.once("open", resolve)),
    new Promise((resolve) => peerSocket.once("open", resolve)),
  ]);

  hostSocket.send(
    JSON.stringify({
      type: "join_room",
      roomId: "room-sync-test",
      peerId: "host-peer",
      nickname: "房主",
      appVersion: "0.1.7",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      connectionMode: "direct_host",
    }),
  );

  await waitForMessage(hostSocket, (payload): payload is { members: Array<{ id: string }> } => {
    return (
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      (payload as { type?: string }).type === "room_snapshot" &&
      Array.isArray((payload as { members?: unknown[] }).members) &&
      (payload as { members: unknown[] }).members.length === 1
    );
  });

  peerSocket.send(
    JSON.stringify({
      type: "join_room",
      roomId: "room-sync-test",
      peerId: "member-peer",
      nickname: "成员",
      appVersion: "0.1.7",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      connectionMode: "direct_host",
    }),
  );

  const snapshot = await waitForMessage(
    hostSocket,
    (payload): payload is { members: Array<{ id: string }> } =>
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      (payload as { type?: string }).type === "room_snapshot" &&
      Array.isArray((payload as { members?: unknown[] }).members) &&
      (payload as { members: unknown[] }).members.length === 2,
  );

  assert.deepEqual(
    snapshot.members.map((member) => member.id).sort(),
    ["host-peer", "member-peer"].sort(),
  );

  hostSocket.close();
  peerSocket.close();
  await server.close();
});
