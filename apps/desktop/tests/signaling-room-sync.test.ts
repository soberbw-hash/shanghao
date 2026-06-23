import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";
import { WebSocket } from "ws";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForMessage = <T>(socket: WebSocket, matcher: (payload: unknown) => payload is T) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);

    const onMessage = (raw: Buffer) => {
      const payload = JSON.parse(raw.toString()) as unknown;
      if (matcher(payload)) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        socket.off("error", onError);
        resolve(payload);
      }
    };
    const onError = (error: Error) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };

    socket.on("message", onMessage);
    socket.on("error", onError);
  });

const openSocket = async (url: string): Promise<WebSocket> => {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
};

const joinChannel = (socket: WebSocket, peerId: string, nickname = peerId) => {
  socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId: "main",
      channelId: "main",
      peerId,
      nickname,
      avatarId: "fox",
      appVersion: "0.1.40",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
  );
};

test("fixed channel acknowledges join before sending the channel snapshot", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);
  const messageTypes: string[] = [];

  try {
    const snapshotReceived = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);
      socket.on("message", (raw) => {
        const payload = JSON.parse(raw.toString()) as { type?: string; peerId?: string; memberCount?: number };
        if (payload.type) messageTypes.push(payload.type);
        if (payload.type === "join_ack") {
          assert.equal(payload.peerId, "ack-peer");
          assert.equal(payload.memberCount, 1);
        }
        if (payload.type === "channel_snapshot") {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    joinChannel(socket, "ack-peer");
    await snapshotReceived;
    assert.equal(messageTypes[0], "join_ack");
    assert.equal(messageTypes[1], "channel_snapshot");
  } finally {
    socket.close();
    await server.close();
  }
});

test("fixed channel syncs members after two peers join", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const second = await openSocket(url);

  try {
    joinChannel(first, "fox");
    await waitForMessage(
      first,
      (payload): payload is { type: string; members: Array<{ id: string; isHost: boolean }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 1,
    );

    joinChannel(second, "cat");
    const snapshot = await waitForMessage(
      first,
      (payload): payload is { members: Array<{ id: string; isHost: boolean }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    assert.deepEqual(snapshot.members.map((member) => member.id).sort(), ["cat", "fox"]);
    assert.equal(snapshot.members.some((member) => member.isHost), false);
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

test("request_snapshot returns a fixed-channel snapshot only to the requester", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const second = await openSocket(url);

  try {
    joinChannel(first, "first");
    joinChannel(second, "second");
    await waitForMessage(
      second,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );
    await wait(100);

    let firstExtraSnapshots = 0;
    first.on("message", (raw) => {
      if ((JSON.parse(raw.toString()) as { type?: string }).type === "channel_snapshot") {
        firstExtraSnapshots += 1;
      }
    });

    const recoveredSnapshot = waitForMessage(
      second,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot",
    );
    second.send(JSON.stringify({ type: "request_snapshot", roomId: "main", peerId: "second" }));
    const recovered = await recoveredSnapshot;
    await wait(100);

    assert.equal(recovered.members.length, 2);
    assert.equal(firstExtraSnapshots, 0);
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

test("fixed channel keeps main room alive after everyone leaves", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);

  try {
    joinChannel(socket, "single");
    await waitForMessage(
      socket,
      (payload): payload is { type: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot",
    );
    socket.send(JSON.stringify({ type: "leave_channel", roomId: "main", peerId: "single" }));
    await wait(100);
    const health = (await fetch(`http://127.0.0.1:${port}/health`).then((response) =>
      response.json(),
    )) as { activeRooms: number; connectedPeers: number };
    assert.equal(health.activeRooms, 1);
    assert.equal(health.connectedPeers, 0);
  } finally {
    socket.close();
    await server.close();
  }
});

test("llm health endpoint tolerates duplicate slashes from client url joins", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();

  try {
    const health = (await fetch(`http://127.0.0.1:${port}//llm/health`).then((response) =>
      response.json(),
    )) as { ok: boolean; configured: boolean };

    assert.equal(health.ok, true);
    assert.equal(typeof health.configured, "boolean");
  } finally {
    await server.close();
  }
});

test("llm chat reads cloud api env that is loaded after module import", async () => {
  const previousKey = process.env.SHANGHAO_LLM_API_KEY;
  const previousUrl = process.env.SHANGHAO_LLM_API_URL;
  const previousModel = process.env.SHANGHAO_LLM_MODEL;

  const upstreamRequests: Array<{ authorization?: string; model?: string }> = [];
  const upstream = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string };
      upstreamRequests.push({
        authorization: request.headers.authorization,
        model: body.model,
      });
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ choices: [{ message: { content: "OK" } }] }));
    });
  });

  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
  const upstreamAddress = upstream.address();
  assert.equal(typeof upstreamAddress, "object");
  const upstreamPort = upstreamAddress?.port;

  process.env.SHANGHAO_LLM_API_KEY = "late-loaded-key";
  process.env.SHANGHAO_LLM_API_URL = `http://127.0.0.1:${upstreamPort}/v1/chat/completions`;
  process.env.SHANGHAO_LLM_MODEL = "late-loaded-model";

  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();

  try {
    const result = (await fetch(`http://127.0.0.1:${port}/llm/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "只回复 OK", history: [] }),
    }).then((response) => response.json())) as { ok: boolean; reply?: string };

    assert.deepEqual(result, { ok: true, reply: "OK" });
    assert.deepEqual(upstreamRequests, [
      { authorization: "Bearer late-loaded-key", model: "late-loaded-model" },
    ]);
  } finally {
    await server.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    if (previousKey === undefined) {
      delete process.env.SHANGHAO_LLM_API_KEY;
    } else {
      process.env.SHANGHAO_LLM_API_KEY = previousKey;
    }
    if (previousUrl === undefined) {
      delete process.env.SHANGHAO_LLM_API_URL;
    } else {
      process.env.SHANGHAO_LLM_API_URL = previousUrl;
    }
    if (previousModel === undefined) {
      delete process.env.SHANGHAO_LLM_MODEL;
    } else {
      process.env.SHANGHAO_LLM_MODEL = previousModel;
    }
  }
});

test("fixed channel broadcasts text chat and knock events", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);

  try {
    joinChannel(sender, "sender");
    joinChannel(receiver, "receiver");
    await waitForMessage(
      receiver,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    sender.send(
      JSON.stringify({
        type: "chat_message",
        roomId: "main",
        peerId: "sender",
        nickname: "sender",
        avatarId: "fox",
        content: "上号",
        createdAt: new Date().toISOString(),
      }),
    );
    const message = await waitForMessage(
      receiver,
      (payload): payload is { type: string; content: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_message",
    );
    assert.equal(message.content, "上号");

    const createdAt = new Date().toISOString();
    sender.send(
      JSON.stringify({
        type: "knock_event",
        roomId: "main",
        peerId: "sender",
        nickname: "小狐狸",
        createdAt,
      }),
    );
    const knock = await waitForMessage(
      receiver,
      (payload): payload is { type: string; nickname: string; createdAt: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "knock_event",
    );
    assert.equal(knock.nickname, "小狐狸");
    assert.equal(knock.createdAt, createdAt);
  } finally {
    sender.close();
    receiver.close();
    await server.close();
  }
});

test("fixed channel relays fallback audio chunks to other peers only", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);

  try {
    joinChannel(sender, "sender");
    joinChannel(receiver, "receiver");
    await waitForMessage(
      receiver,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    sender.send(
      JSON.stringify({
        type: "audio_chunk",
        roomId: "main",
        peerId: "sender",
        sourcePeerId: "sender",
        audioSessionId: "session-a",
        audioStreamEpoch: 3,
        audioPath: "relay",
        sequence: 1,
        sentAt: Date.now(),
        durationMs: 40,
        sampleRate: 48_000,
        channelCount: 1,
        data: "AAAA",
      }),
    );

    const chunk = await waitForMessage(
      receiver,
      (payload): payload is { sourcePeerId: string; data: string; serverSequence: number } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "audio_chunk",
    );
    assert.equal(chunk.sourcePeerId, "sender");
    assert.equal(chunk.data, "AAAA");
    assert.equal(typeof chunk.serverSequence, "number");
  } finally {
    sender.close();
    receiver.close();
    await server.close();
  }
});

test("fixed channel relays fallback screen frames and stop state to other peers only", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);

  try {
    joinChannel(sender, "sender");
    joinChannel(receiver, "receiver");
    await waitForMessage(
      receiver,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    sender.send(
      JSON.stringify({
        type: "screen_frame",
        roomId: "main",
        peerId: "sender",
        sourcePeerId: "sender",
        sequence: 7,
        sentAt: Date.now(),
        width: 320,
        height: 180,
        data: "data:image/jpeg;base64,AAAA",
      }),
    );

    const frame = await waitForMessage(
      receiver,
      (payload): payload is { type: string; sourcePeerId: string; sequence: number; data: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "screen_frame",
    );
    assert.equal(frame.sourcePeerId, "sender");
    assert.equal(frame.sequence, 7);
    assert.equal(frame.data, "data:image/jpeg;base64,AAAA");

    sender.send(
      JSON.stringify({
        type: "screen_share_state",
        roomId: "main",
        peerId: "sender",
        isSharing: false,
      }),
    );

    const stopped = await waitForMessage(
      receiver,
      (payload): payload is { type: string; peerId: string; isSharing: boolean } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "screen_share_state",
    );
    assert.equal(stopped.peerId, "sender");
    assert.equal(stopped.isSharing, false);
  } finally {
    sender.close();
    receiver.close();
    await server.close();
  }
});

test("fixed channel keeps a reconnecting member during grace and replaces same peer socket", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const peer = await openSocket(url);

  try {
    joinChannel(first, "first");
    await waitForMessage(
      first,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 1,
    );

    joinChannel(peer, "peer");
    const joined = await waitForMessage(
      first,
      (payload): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    peer.close();
    const reconnecting = await waitForMessage(
      first,
      (payload): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { revision?: number }).revision > joined.revision &&
        (payload as { members?: Array<{ id: string; presenceState: string }> }).members?.some(
          (member) => member.id === "peer" && member.presenceState === "reconnecting",
        ) === true,
    );
    assert.equal(reconnecting.members.length, 2);

    const replacement = await openSocket(url);
    joinChannel(replacement, "peer");
    const restored = await waitForMessage(
      first,
      (payload): payload is { members: Array<{ id: string; presenceState: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: Array<{ id: string; presenceState: string }> }).members?.some(
          (member) => member.id === "peer" && member.presenceState === "online",
        ) === true,
    );
    assert.equal(restored.members.length, 2);
    replacement.close();
  } finally {
    first.close();
    await server.close();
  }
});
