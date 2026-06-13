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

test("signaling server relays fallback audio chunks to other room members only", async () => {
  const server = new SignalingServer({ roomName: "audio-relay-test" });
  const port = await server.listen();

  const url = `ws://127.0.0.1:${port}`;
  const hostSocket = new WebSocket(url);
  const peerSocket = new WebSocket(url);

  await Promise.all([
    new Promise((resolve) => hostSocket.once("open", resolve)),
    new Promise((resolve) => peerSocket.once("open", resolve)),
  ]);

  for (const [socket, peerId, nickname] of [
    [hostSocket, "host-peer", "host"],
    [peerSocket, "member-peer", "member"],
  ] as const) {
    socket.send(
      JSON.stringify({
        type: "join_room",
        roomId: "audio-relay-room",
        peerId,
        nickname,
        appVersion: "0.1.17",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
        connectionMode: "direct_host",
      }),
    );
  }

  await waitForMessage(
    peerSocket,
    (payload): payload is { type: string; members: Array<{ id: string }> } =>
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      (payload as { type?: string }).type === "room_snapshot" &&
      Array.isArray((payload as { members?: unknown[] }).members) &&
      (payload as { members: unknown[] }).members.length === 2,
  );

  hostSocket.send(
    JSON.stringify({
      type: "audio_chunk",
      roomId: "audio-relay-room",
      peerId: "host-peer",
      sequence: 1,
      sentAt: Date.now(),
      durationMs: 40,
      sampleRate: 48000,
      channelCount: 1,
      data: "AAAA",
    }),
  );

  const chunk = await waitForMessage(
    peerSocket,
    (payload): payload is { type: string; peerId: string; data: string } =>
      typeof payload === "object" &&
      payload !== null &&
      "type" in payload &&
      (payload as { type?: string }).type === "audio_chunk",
  );

  assert.equal(chunk.peerId, "host-peer");
  assert.equal(chunk.data, "AAAA");

  hostSocket.close();
  peerSocket.close();
  await server.close();
});

test("signaling server keeps a disconnected member during grace and replaces the same peer socket", async () => {
  const server = new SignalingServer({ roomName: "reconnect-grace-test" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const hostSocket = new WebSocket(url);
  const firstPeerSocket = new WebSocket(url);

  await Promise.all([
    new Promise((resolve) => hostSocket.once("open", resolve)),
    new Promise((resolve) => firstPeerSocket.once("open", resolve)),
  ]);

  const join = (socket: WebSocket, peerId: string, nickname: string) =>
    socket.send(
      JSON.stringify({
        type: "join_room",
        roomId: "reconnect-room",
        peerId,
        nickname,
        appVersion: "0.1.23",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
        connectionMode: "relay",
      }),
    );

  join(hostSocket, "host-peer", "房主");
  await waitForMessage(
    hostSocket,
    (payload): payload is { revision: number; members: Array<{ id: string }> } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "room_snapshot" &&
      (payload as { members?: unknown[] }).members?.length === 1,
  );

  join(firstPeerSocket, "member-peer", "成员");
  const joined = await waitForMessage(
    hostSocket,
    (payload): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "room_snapshot" &&
      (payload as { members?: unknown[] }).members?.length === 2,
  );

  firstPeerSocket.close();
  const reconnecting = await waitForMessage(
    hostSocket,
    (payload): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "room_snapshot" &&
      (payload as { revision?: number }).revision > joined.revision &&
      (payload as { members?: Array<{ id: string; presenceState: string }> }).members?.some(
        (member) => member.id === "member-peer" && member.presenceState === "reconnecting",
      ) === true,
  );
  assert.equal(reconnecting.members.length, 2);

  const replacementSocket = new WebSocket(url);
  await new Promise((resolve) => replacementSocket.once("open", resolve));
  join(replacementSocket, "member-peer", "成员");
  const restored = await waitForMessage(
    hostSocket,
    (payload): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "room_snapshot" &&
      (payload as { revision?: number }).revision > reconnecting.revision &&
      (payload as { members?: Array<{ id: string; presenceState: string }> }).members?.some(
        (member) => member.id === "member-peer" && member.presenceState === "online",
      ) === true,
  );

  assert.equal(restored.members.length, 2);
  assert.deepEqual(restored.members.map((member) => member.id).sort(), ["host-peer", "member-peer"]);

  hostSocket.close();
  replacementSocket.close();
  await server.close();
});

test("signaling server broadcasts chat messages to connected room members", async () => {
  const server = new SignalingServer({ roomName: "chat-test" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = new WebSocket(url);
  const receiver = new WebSocket(url);
  await Promise.all([
    new Promise((resolve) => sender.once("open", resolve)),
    new Promise((resolve) => receiver.once("open", resolve)),
  ]);

  for (const [socket, peerId] of [[sender, "sender"], [receiver, "receiver"]] as const) {
    socket.send(JSON.stringify({
      type: "join_room",
      roomId: "chat-room",
      peerId,
      nickname: peerId,
      appVersion: "0.1.23",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      connectionMode: "relay",
    }));
  }
  await waitForMessage(
    receiver,
    (payload): payload is { members: unknown[] } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "room_snapshot" &&
      (payload as { members?: unknown[] }).members?.length === 2,
  );

  sender.send(JSON.stringify({
    type: "chat_message",
    roomId: "chat-room",
    peerId: "sender",
    nickname: "sender",
    content: "上号",
    createdAt: new Date().toISOString(),
  }));

  const message = await waitForMessage(
    receiver,
    (payload): payload is { type: string; content: string } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "chat_message",
  );
  assert.equal(message.content, "上号");

  sender.close();
  receiver.close();
  await server.close();
});
