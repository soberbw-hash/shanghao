import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";
import { WebSocket } from "ws";

import { ChatHistoryStore } from "../../../packages/signaling/src/chat-history-store";
import { isSignalEnvelope } from "../../../packages/signaling/src/protocol";

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

const join = (socket: WebSocket, peerId: string, nickname: string) => {
  socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId: "main",
      channelId: "main",
      peerId,
      nickname,
      avatarId: "fox",
      appVersion: "0.1.50",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
  );
};

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
