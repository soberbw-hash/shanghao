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

const openSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const sendJoin = (socket: WebSocket, roomId: string, peerId: string, avatarDataUrl?: string) => {
  socket.send(JSON.stringify({
    type: "join_room",
    roomId,
    peerId,
    nickname: peerId,
    avatarDataUrl,
    appVersion: "0.1.24",
    protocolVersion: APP_PROTOCOL_VERSION,
    buildNumber: APP_BUILD_NUMBER,
    connectionMode: "relay",
  }));
};

test("signaling server acknowledges join before sending the room snapshot", async () => {
  const server = new SignalingServer({ roomName: "join-ack-test" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);
  const messageTypes: string[] = [];

  const snapshotReceived = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString()) as {
        type?: string;
        peerId?: string;
        memberCount?: number;
        revision?: number;
      };
      if (payload.type) {
        messageTypes.push(payload.type);
      }
      if (payload.type === "join_ack") {
        assert.equal(payload.peerId, "ack-peer");
        assert.equal(payload.memberCount, 1);
        assert.equal(typeof payload.revision, "number");
      }
      if (payload.type === "room_snapshot") {
        clearTimeout(timer);
        resolve();
      }
    });
  });

  sendJoin(socket, "join-ack-room", "ack-peer");
  await snapshotReceived;
  assert.equal(messageTypes[0], "join_ack");
  assert.equal(messageTypes[1], "room_snapshot");

  socket.close();
  await server.close();
});

test("request_snapshot returns a lightweight snapshot only to the requester", async () => {
  const server = new SignalingServer({ roomName: "snapshot-recovery-test" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const host = await openSocket(url);
  const peer = await openSocket(url);
  const hostInitialSnapshot = waitForMessage(host, (payload): payload is { type: string } =>
    typeof payload === "object" && payload !== null &&
    (payload as { type?: string }).type === "room_snapshot");
  sendJoin(host, "snapshot-recovery-room", "host");
  await hostInitialSnapshot;
  const peerJoinedSnapshot = waitForMessage(peer, (payload): payload is { members: unknown[] } =>
    typeof payload === "object" && payload !== null &&
    (payload as { type?: string }).type === "room_snapshot" &&
    (payload as { members?: unknown[] }).members?.length === 2);
  sendJoin(peer, "snapshot-recovery-room", "peer");
  await peerJoinedSnapshot;
  await new Promise((resolve) => setTimeout(resolve, 100));

  let hostSnapshotCount = 0;
  host.on("message", (raw) => {
    if ((JSON.parse(raw.toString()) as { type?: string }).type === "room_snapshot") {
      hostSnapshotCount += 1;
    }
  });
  const recoveredSnapshot = waitForMessage(peer, (payload): payload is { members: unknown[] } =>
    typeof payload === "object" && payload !== null &&
    (payload as { type?: string }).type === "room_snapshot");
  peer.send(JSON.stringify({
    type: "request_snapshot",
    roomId: "snapshot-recovery-room",
    peerId: "peer",
  }));
  const recovered = await recoveredSnapshot;
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(recovered.members.length, 2);
  assert.equal(hostSnapshotCount, 0);
  host.close();
  peer.close();
  await server.close();
});

test("room snapshots omit avatar data and avatars use a separate bounded message", async () => {
  const server = new SignalingServer({ roomName: "avatar-snapshot-test" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);
  const avatarDataUrl = `data:image/png;base64,${"A".repeat(512)}`;
  const snapshotPromise = waitForMessage(
    socket,
    (payload): payload is { members: Array<{ avatarDataUrl?: string; avatarHash?: string }> } =>
      typeof payload === "object" && payload !== null &&
      (payload as { type?: string }).type === "room_snapshot",
  );
  const avatarPromise = waitForMessage(
    socket,
    (payload): payload is { avatarDataUrl: string; avatarHash?: string } =>
      typeof payload === "object" && payload !== null &&
      (payload as { type?: string }).type === "avatar_update",
  );
  sendJoin(socket, "avatar-room", "avatar-peer", avatarDataUrl);

  const [snapshot, avatar] = await Promise.all([snapshotPromise, avatarPromise]);

  assert.equal(snapshot.members[0]?.avatarDataUrl, undefined);
  assert.equal(typeof snapshot.members[0]?.avatarHash, "string");
  assert.equal(avatar.avatarDataUrl, avatarDataUrl);
  socket.close();
  await server.close();
});

test("health endpoint exposes signaling version and room counts", async () => {
  const server = new SignalingServer({ roomName: "health-test" });
  const port = await server.listen();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const health = await response.json() as Record<string, unknown>;

  assert.equal(health.ok, true);
  assert.equal(health.protocolVersion, APP_PROTOCOL_VERSION);
  assert.equal(health.buildNumber, APP_BUILD_NUMBER);
  assert.equal(typeof health.uptime, "number");
  assert.equal(health.activeRooms, 0);
  assert.equal(health.connectedPeers, 0);
  await server.close();
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
