import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  BUILT_IN_AVATAR_IDS,
  type BuiltInAvatarId,
} from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";
import { WebSocket } from "ws";

import { ChatHistoryStore } from "../../../packages/signaling/src/chat-history-store";
import { isSignalEnvelope, isValidNickname } from "../../../packages/signaling/src/protocol";
import { SessionTokenStore } from "../../../packages/signaling/src/session-token-store";

const openSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
};

const waitForMessage = <T>(
  socket: WebSocket,
  matcher: (payload: unknown) => payload is T,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("message_timeout")), 4_000);
    const listener = (raw: Buffer) => {
      const payload = JSON.parse(raw.toString()) as unknown;
      if (!matcher(payload)) return;
      clearTimeout(timeout);
      socket.off("message", listener);
      resolve(payload);
    };
    socket.on("message", listener);
  });

const waitForClose = (socket: WebSocket): Promise<number> =>
  new Promise((resolve) => socket.once("close", (code) => resolve(code)));

let nextAvatarIndex = 0;
const join = (
  socket: WebSocket,
  peerId: string,
  nickname: string,
  sessionToken?: string,
  avatarId: BuiltInAvatarId = BUILT_IN_AVATAR_IDS[nextAvatarIndex++ % BUILT_IN_AVATAR_IDS.length]!,
) => {
  socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId: "main",
      channelId: "main",
      peerId,
      nickname,
      avatarId,
      appVersion: "0.1.50",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      sessionToken,
    }),
  );
};

const waitForJoinAck = (socket: WebSocket) =>
  waitForMessage(
    socket,
    (payload): payload is { type: "join_ack"; peerId: string; sessionToken: string } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "join_ack" &&
      typeof (payload as { sessionToken?: unknown }).sessionToken === "string",
  );

const waitForMemberCount = (socket: WebSocket, count: number) =>
  waitForMessage(
    socket,
    (
      payload,
    ): payload is { type: "channel_snapshot"; members: Array<{ id: string; isMuted: boolean }> } =>
      typeof payload === "object" &&
      payload !== null &&
      (payload as { type?: string }).type === "channel_snapshot" &&
      (payload as { members?: unknown[] }).members?.length === count,
  );

test("relay token is required and never appears in logs", async () => {
  const previousToken = process.env.RELAY_ACCESS_TOKEN;
  process.env.RELAY_ACCESS_TOKEN = "unit-test-secret-token";
  const logs: string[] = [];
  const server = new SignalingServer({
    roomName: "固定频道",
    logger: (message, context) => logs.push(JSON.stringify({ message, context })),
  });
  const port = await server.listen();

  try {
    const missing = await openSocket(`ws://127.0.0.1:${port}`);
    assert.equal(await waitForClose(missing), 4401);

    const wrong = await openSocket(`ws://127.0.0.1:${port}?token=wrong`);
    assert.equal(await waitForClose(wrong), 4401);

    const valid = await openSocket(
      `ws://127.0.0.1:${port}?token=${encodeURIComponent(process.env.RELAY_ACCESS_TOKEN)}`,
    );
    const snapshot = waitForMemberCount(valid, 1);
    join(valid, "authorized-peer", "小狐狸");
    await snapshot;
    valid.close();

    assert.equal(logs.join("\n").includes("unit-test-secret-token"), false);
  } finally {
    await server.close();
    if (previousToken === undefined) delete process.env.RELAY_ACCESS_TOKEN;
    else process.env.RELAY_ACCESS_TOKEN = previousToken;
  }
});

test("temporary ICE configuration is authenticated and reports TURN transports", async () => {
  const previousToken = process.env.RELAY_ACCESS_TOKEN;
  const previousUrls = process.env.TURN_URLS;
  const previousSecret = process.env.TURN_SHARED_SECRET;
  process.env.RELAY_ACCESS_TOKEN = "ice-config-test-token";
  process.env.TURN_URLS = [
    "turn:relay.example.com:3478?transport=udp",
    "turn:relay.example.com:3478?transport=tcp",
    "turns:relay.example.com:5349?transport=tcp",
  ].join(",");
  process.env.TURN_SHARED_SECRET = "ice-config-turn-secret";
  const logs: string[] = [];
  const server = new SignalingServer({
    roomName: "固定频道",
    logger: (message, context) => logs.push(JSON.stringify({ message, context })),
  });
  const port = await server.listen();

  try {
    const missing = await fetch(`http://127.0.0.1:${port}/ice-config?peerId=test-peer`);
    assert.equal(missing.status, 401);

    const response = await fetch(`http://127.0.0.1:${port}/ice-config?peerId=test-peer`, {
      headers: { authorization: `Bearer ${process.env.RELAY_ACCESS_TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const payload = (await response.json()) as {
      iceServers: Array<{ urls: string[]; username: string; credential: string }>;
      serverTime: number;
      turnConfigured: boolean;
      supportedTurnTransports: string[];
    };
    assert.equal(payload.turnConfigured, true);
    assert.equal(Number.isFinite(payload.serverTime), true);
    assert.deepEqual(payload.supportedTurnTransports.sort(), ["tcp", "tls", "udp"]);
    assert.match(payload.iceServers[0]?.username ?? "", /^\d+:test-peer$/);
    assert.equal(logs.join("\n").includes("ice-config-test-token"), false);
    assert.equal(logs.join("\n").includes("ice-config-turn-secret"), false);
  } finally {
    await server.close();
    if (previousToken === undefined) delete process.env.RELAY_ACCESS_TOKEN;
    else process.env.RELAY_ACCESS_TOKEN = previousToken;
    if (previousUrls === undefined) delete process.env.TURN_URLS;
    else process.env.TURN_URLS = previousUrls;
    if (previousSecret === undefined) delete process.env.TURN_SHARED_SECRET;
    else process.env.TURN_SHARED_SECRET = previousSecret;
  }
});

test("socket identity overrides spoofed peer, nickname, and audio source", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const first = await openSocket(`ws://127.0.0.1:${port}`);
  const second = await openSocket(`ws://127.0.0.1:${port}`);

  try {
    let snapshot = waitForMemberCount(first, 1);
    join(first, "peer-a", "小狐狸");
    await snapshot;
    snapshot = waitForMemberCount(second, 2);
    join(second, "peer-b", "小猫");
    await snapshot;

    const stateMessage = waitForMessage(
      second,
      (payload): payload is { type: "member_state"; peerId: string; isMuted: boolean } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "member_state",
    );
    first.send(
      JSON.stringify({
        type: "member_state",
        roomId: "main",
        peerId: "peer-b",
        isMuted: true,
      }),
    );
    assert.equal((await stateMessage).peerId, "peer-a");

    const chatMessage = waitForMessage(
      second,
      (
        payload,
      ): payload is { type: "chat_message"; peerId: string; nickname: string; content: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_message",
    );
    first.send(
      JSON.stringify({
        type: "chat_message",
        roomId: "main",
        peerId: "peer-b",
        nickname: "冒充者",
        content: "真实发送者测试",
      }),
    );
    const chat = await chatMessage;
    assert.equal(chat.peerId, "peer-a");
    assert.equal(chat.nickname, "小狐狸");

    const audioMessage = waitForMessage(
      second,
      (payload): payload is { type: "audio_chunk"; peerId: string; sourcePeerId: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "audio_chunk",
    );
    first.send(
      JSON.stringify({
        type: "audio_chunk",
        roomId: "main",
        peerId: "peer-b",
        sourcePeerId: "peer-b",
        audioSessionId: "session-a",
        audioStreamEpoch: 0,
        audioPath: "relay",
        sequence: 0,
        sentAt: Date.now(),
        durationMs: 20,
        sampleRate: 16_000,
        channelCount: 1,
        codec: "mulaw",
        data: "AA==",
      }),
    );
    const audio = await audioMessage;
    assert.equal(audio.peerId, "peer-a");
    assert.equal(audio.sourcePeerId, "peer-a");

    const mismatch = waitForMessage(
      first,
      (payload): payload is { type: "error"; code: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "error" &&
        (payload as { code?: string }).code === "room_mismatch",
    );
    first.send(
      JSON.stringify({
        type: "member_state",
        roomId: "other-room",
        peerId: "peer-a",
        isMuted: false,
      }),
    );
    assert.equal((await mismatch).code, "room_mismatch");

    const remaining = waitForMemberCount(second, 1);
    first.send(JSON.stringify({ type: "leave_channel", roomId: "main", peerId: "peer-b" }));
    assert.deepEqual(
      (await remaining).members.map((member) => member.id),
      ["peer-b"],
    );
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

test("reconnect session token rotates and an invalid token cannot replace the old peer", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const first = await openSocket(`ws://127.0.0.1:${port}`);

  try {
    const firstAckPromise = waitForJoinAck(first);
    join(first, "stable-peer", "小狐狸");
    const firstAck = await firstAckPromise;
    assert.equal(firstAck.peerId, "stable-peer");
    assert.ok(firstAck.sessionToken.length >= 40);

    const attacker = await openSocket(`ws://127.0.0.1:${port}`);
    const rejection = waitForMessage(
      attacker,
      (payload): payload is { type: "error"; code: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "error" &&
        (payload as { code?: string }).code === "reconnect_session_invalid",
    );
    join(attacker, "stable-peer", "冒充者", "wrong-token");
    assert.equal((await rejection).code, "reconnect_session_invalid");

    const pong = waitForMessage(
      first,
      (payload): payload is { type: "pong" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "pong",
    );
    first.send(
      JSON.stringify({
        type: "heartbeat",
        roomId: "main",
        peerId: "stable-peer",
        sentAt: Date.now(),
      }),
    );
    await pong;
    assert.equal(first.readyState, WebSocket.OPEN);
    attacker.close();

    first.close();
    await new Promise<void>((resolve) => first.once("close", () => resolve()));

    const resumed = await openSocket(`ws://127.0.0.1:${port}`);
    const resumedAckPromise = waitForJoinAck(resumed);
    join(resumed, "stable-peer", "小狐狸", firstAck.sessionToken);
    const resumedAck = await resumedAckPromise;
    assert.notEqual(resumedAck.sessionToken, firstAck.sessionToken);
    resumed.close();
  } finally {
    first.close();
    await server.close();
  }
});

test("expired reconnect session tokens cannot be resumed", () => {
  const store = new SessionTokenStore(20_000);
  const token = store.issue("main", "peer-a", 1_000);
  store.markDisconnected("main", "peer-a", 2_000);
  assert.equal(store.resume("main", "peer-a", token, 22_001).status, "expired");
  assert.equal(store.resume("main", "peer-a", token, 22_002).status, "missing");
});

test("three invalid messages close a socket without crashing the server", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);
  try {
    const closed = waitForClose(socket);
    socket.send("not-json");
    socket.send("not-json");
    socket.send("not-json");
    assert.equal(await closed, 4400);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.ok, true);
  } finally {
    socket.close();
    await server.close();
  }
});

test("legacy empty game names stay connected and normalize to an omitted value", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);
  try {
    const snapshot = waitForMemberCount(socket, 1);
    join(socket, "legacy-peer", "小狐狸");
    await snapshot;

    for (let index = 0; index < 3; index += 1) {
      const state = waitForMessage(
        socket,
        (payload): payload is { type: "member_state"; gameName?: string } =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { type?: string }).type === "member_state",
      );
      socket.send(
        JSON.stringify({
          type: "member_state",
          roomId: "main",
          peerId: "legacy-peer",
          activity: "idle",
          gameName: "",
        }),
      );
      assert.equal((await state).gameName, undefined);
    }

    const pong = waitForMessage(
      socket,
      (payload): payload is { type: "pong" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "pong",
    );
    socket.send(
      JSON.stringify({
        type: "heartbeat",
        roomId: "main",
        peerId: "legacy-peer",
        sentAt: Date.now(),
      }),
    );
    await pong;
    assert.equal(socket.readyState, WebSocket.OPEN);
  } finally {
    socket.close();
    await server.close();
  }
});

test("chat history keeps 100 messages and survives a restart", async () => {
  const memoryStore = await ChatHistoryStore.create();
  for (let index = 0; index < 101; index += 1) {
    memoryStore.append("main", {
      id: `message-${index}`,
      peerId: "peer-a",
      nickname: "小狐狸",
      content: `第 ${index} 条`,
      createdAt: new Date(1_700_000_000_000 + index).toISOString(),
    });
  }
  assert.equal(memoryStore.get("main").length, 100);
  assert.equal(memoryStore.get("main")[0]?.id, "message-1");

  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-chat-"));
  const filePath = path.join(directory, "chat-history.json");
  try {
    const first = await ChatHistoryStore.create(filePath);
    first.append("main", {
      id: "persisted-message",
      peerId: "peer-a",
      nickname: "小狐狸",
      content: "服务重启后还在",
      createdAt: new Date().toISOString(),
    });
    await first.flush();

    const second = await ChatHistoryStore.create(filePath);
    assert.equal(second.get("main")[0]?.content, "服务重启后还在");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("chat history recovers from the exact backup when the primary file is damaged", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-chat-backup-"));
  const filePath = path.join(directory, "chat-history.json");
  const logs: Array<{ message: string; context?: Record<string, unknown> }> = [];
  try {
    const first = await ChatHistoryStore.create(filePath);
    first.append("main", {
      id: "backup-message",
      peerId: "peer-a",
      nickname: "小狐狸",
      content: "备份里的消息",
      createdAt: new Date().toISOString(),
    });
    await first.flush();
    first.append("main", {
      id: "latest-message",
      peerId: "peer-a",
      nickname: "小狐狸",
      content: "主文件里的新消息",
      createdAt: new Date(Date.now() + 1_000).toISOString(),
    });
    await first.flush();

    await writeFile(filePath, "{ damaged", "utf8");
    const recovered = await ChatHistoryStore.create(filePath, (message, context) =>
      logs.push({ message, context }),
    );

    assert.deepEqual(
      recovered.get("main").map((message) => message.id),
      ["backup-message"],
    );
    assert.equal(
      logs.some(
        (entry) => entry.message === "chat history loaded" && entry.context?.source === "backup",
      ),
      true,
    );
    assert.equal(
      logs.some((entry) => JSON.stringify(entry).includes(directory)),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("strict protocol validator rejects dangerous payload shapes", () => {
  assert.equal(isValidNickname("摸鱼小猫"), true);
  assert.equal(isValidNickname("D.A.D.D.Y"), false);
  assert.equal(isValidNickname("yourdada123"), false);
  assert.equal(isValidNickname("your-d4ddy-123"), false);
  assert.equal(isValidNickname("习 近 平"), false);
  assert.equal(isValidNickname("8964"), false);
  assert.equal(
    isSignalEnvelope({ type: "member_state", roomId: "main", peerId: "a", isMuted: "yes" }),
    false,
  );
  assert.equal(
    isSignalEnvelope({ type: "chat_message", roomId: "main", content: " ".repeat(4) }),
    false,
  );
  assert.equal(
    isSignalEnvelope({
      type: "chat_message",
      roomId: "main",
      content: "",
      image: {
        mimeType: "image/webp",
        dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ",
        width: 640,
        height: 360,
        fileName: "截图.webp",
      },
    }),
    true,
  );
  assert.equal(
    isSignalEnvelope({
      type: "chat_message",
      roomId: "main",
      content: "",
      image: {
        mimeType: "image/webp",
        dataUrl: "data:image/webp;base64,AAAA",
        width: 640,
        height: 360,
      },
    }),
    false,
  );
  assert.equal(
    isSignalEnvelope({
      type: "chat_message",
      roomId: "main",
      content: "",
      image: {
        mimeType: "image/gif",
        dataUrl: "https://example.com/tracker.gif",
        width: 640,
        height: 360,
      },
    }),
    false,
  );
  assert.equal(
    isSignalEnvelope({
      type: "audio_chunk",
      roomId: "main",
      peerId: "a",
      sourcePeerId: "a",
      audioSessionId: "session-a",
      audioStreamEpoch: 0,
      sequence: -1,
      sentAt: Date.now(),
      durationMs: 20,
      sampleRate: 96_000,
      channelCount: 1,
      data: "not base64",
    }),
    false,
  );
  assert.equal(
    isSignalEnvelope({
      type: "join_channel",
      roomId: "main",
      channelId: "main",
      peerId: "a",
      nickname: "含\n换行",
      avatarId: "fox",
      appVersion: "0.1.50",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
    false,
  );
});
