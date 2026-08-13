import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  BUILT_IN_AVATAR_IDS,
  type BuiltInAvatarId,
} from "@private-voice/shared";
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

let nextAvatarIndex = 0;
const joinChannel = (
  socket: WebSocket,
  peerId: string,
  nickname = peerId,
  sessionToken?: string,
  avatarId: BuiltInAvatarId = BUILT_IN_AVATAR_IDS[nextAvatarIndex++ % BUILT_IN_AVATAR_IDS.length]!,
  profileId?: string,
  roomId: "main" | "side" = "main",
) => {
  socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId,
      channelId: roomId,
      peerId,
      profileId,
      nickname,
      avatarId,
      appVersion: "0.1.40",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
      sessionToken,
    }),
  );
};

test("main and side channels isolate content while sharing online counts", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const mainOne = await openSocket(url);
  const mainTwo = await openSocket(url);
  const sideOne = await openSocket(url);
  const sideChatSeenInMain: unknown[] = [];
  const onMainMessage = (raw: Buffer) => {
    const payload = JSON.parse(raw.toString()) as { type?: string; content?: string };
    if (payload.type === "chat_message" && payload.content === "副房消息") {
      sideChatSeenInMain.push(payload);
    }
  };
  mainOne.on("message", onMainMessage);

  try {
    for (const [socket, peerId, roomId] of [
      [mainOne, "main-one", "main"],
      [mainTwo, "main-two", "main"],
    ] as const) {
      const joined = waitForMessage(
        socket,
        (payload): payload is { type: "join_ack" } =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { type?: string }).type === "join_ack",
      );
      joinChannel(socket, peerId, peerId, undefined, undefined, undefined, roomId);
      await joined;
    }

    const mainCounts = waitForMessage(
      mainOne,
      (payload): payload is { type: "channel_counts"; counts: { main: number; side: number } } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_counts" &&
        (payload as { counts?: { main?: number; side?: number } }).counts?.main === 2 &&
        (payload as { counts?: { main?: number; side?: number } }).counts?.side === 1,
    );
    const sideCounts = waitForMessage(
      sideOne,
      (payload): payload is { type: "channel_counts"; counts: { main: number; side: number } } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_counts" &&
        (payload as { counts?: { main?: number; side?: number } }).counts?.main === 2 &&
        (payload as { counts?: { main?: number; side?: number } }).counts?.side === 1,
    );
    const sideJoined = waitForMessage(
      sideOne,
      (payload): payload is { type: "join_ack" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "join_ack",
    );
    joinChannel(sideOne, "side-one", "side-one", undefined, undefined, undefined, "side");
    await Promise.all([sideJoined, mainCounts, sideCounts]);

    const sideChat = waitForMessage(
      sideOne,
      (payload): payload is { type: "chat_message"; content: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_message" &&
        (payload as { content?: string }).content === "副房消息",
    );
    sideOne.send(JSON.stringify({ type: "chat_message", roomId: "side", content: "副房消息" }));
    assert.equal((await sideChat).content, "副房消息");
    await wait(120);
    assert.equal(sideChatSeenInMain.length, 0);

    const sideEmptied = waitForMessage(
      mainOne,
      (payload): payload is { type: "channel_counts"; counts: { main: number; side: number } } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_counts" &&
        (payload as { counts?: { main?: number; side?: number } }).counts?.main === 2 &&
        (payload as { counts?: { main?: number; side?: number } }).counts?.side === 0,
    );
    sideOne.close();
    assert.deepEqual((await sideEmptied).counts, { main: 2, side: 0 });
  } finally {
    mainOne.off("message", onMainMessage);
    mainOne.close();
    mainTwo.close();
    sideOne.close();
    await server.close();
  }
});

test("five clients receive rapid text and image chat once while duplicate retries reuse the ACK", async () => {
  const server = new SignalingServer({ roomName: "聊天可靠性" });
  const port = await server.listen();
  const sockets = await Promise.all(
    Array.from({ length: 5 }, () => openSocket(`ws://127.0.0.1:${port}`)),
  );
  const received = sockets.map(() => new Map<string, string>());
  const acknowledgements: Array<{
    clientMessageId: string;
    messageId: string;
    duplicate: boolean;
  }> = [];

  sockets.forEach((socket, index) => {
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString()) as {
        type?: string;
        clientMessageId?: string;
        id?: string;
        messageId?: string;
        duplicate?: boolean;
      };
      if (payload.type === "chat_message" && payload.clientMessageId && payload.id) {
        received[index]?.set(payload.clientMessageId, payload.id);
      }
      if (
        index === 0 &&
        payload.type === "chat_ack" &&
        payload.clientMessageId &&
        payload.messageId
      ) {
        acknowledgements.push({
          clientMessageId: payload.clientMessageId,
          messageId: payload.messageId,
          duplicate: payload.duplicate === true,
        });
      }
    });
  });

  try {
    for (let index = 0; index < sockets.length; index += 1) {
      const socket = sockets[index]!;
      const joined = waitForMessage(socket, (payload): payload is { type: "join_ack" } =>
        Boolean(
          payload &&
          typeof payload === "object" &&
          (payload as { type?: string }).type === "join_ack",
        ),
      );
      joinChannel(socket, `chat-peer-${index}`, `成员${index}`);
      await joined;
    }

    const messages = Array.from({ length: 25 }, (_, index) => ({
      type: "chat_message" as const,
      roomId: "main",
      clientMessageId: `five-chat-${index}`,
      content: index < 20 ? `文字 ${index}` : "",
      ...(index < 20
        ? {}
        : {
            image: {
              mimeType: "image/webp",
              dataUrl: "data:image/webp;base64,UklGRgAAAABXRUJQ",
              width: 1,
              height: 1,
              fileName: `图片-${index}.webp`,
            },
          }),
    }));
    for (const message of messages) sockets[0]!.send(JSON.stringify(message));

    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && received.some((client) => client.size < messages.length)) {
      await wait(20);
    }
    for (const client of received) assert.equal(client.size, messages.length);
    assert.equal(acknowledgements.length, messages.length);

    sockets[0]!.send(JSON.stringify(messages[0]));
    const retryDeadline = Date.now() + 2_000;
    while (
      Date.now() < retryDeadline &&
      !acknowledgements.some((ack) => ack.clientMessageId === "five-chat-0" && ack.duplicate)
    ) {
      await wait(20);
    }
    const firstAcks = acknowledgements.filter((ack) => ack.clientMessageId === "five-chat-0");
    assert.equal(firstAcks.length, 2);
    assert.equal(firstAcks[0]?.messageId, firstAcks[1]?.messageId);
    for (const client of received) assert.equal(client.size, messages.length);
  } finally {
    sockets.forEach((socket) => socket.close());
    await server.close();
  }
});

test("a retry after socket loss reuses the accepted message across a new peer session", async () => {
  const server = new SignalingServer({ roomName: "聊天断线重试" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const receiver = await openSocket(url);
  const firstSender = await openSocket(url);
  const profileId = "3be6f23c-2c54-4a8c-b67e-c6a45148aa85";
  const clientMessageId = "ack-lost-retry-message";
  const receivedIds: string[] = [];
  receiver.on("message", (raw) => {
    const payload = JSON.parse(raw.toString()) as {
      type?: string;
      clientMessageId?: string;
      id?: string;
    };
    if (
      payload.type === "chat_message" &&
      payload.clientMessageId === clientMessageId &&
      payload.id
    ) {
      receivedIds.push(payload.id);
    }
  });

  try {
    const receiverJoined = waitForMessage(receiver, (payload): payload is { type: "join_ack" } =>
      Boolean(
        payload &&
        typeof payload === "object" &&
        (payload as { type?: string }).type === "join_ack",
      ),
    );
    joinChannel(receiver, "retry-receiver");
    await receiverJoined;

    const senderJoined = waitForMessage(firstSender, (payload): payload is { type: "join_ack" } =>
      Boolean(
        payload &&
        typeof payload === "object" &&
        (payload as { type?: string }).type === "join_ack",
      ),
    );
    joinChannel(firstSender, "retry-sender-a", "发送者", undefined, "duck", profileId);
    await senderJoined;

    const firstDelivery = waitForMessage(
      receiver,
      (payload): payload is { type: "chat_message"; id: string; clientMessageId: string } =>
        Boolean(
          payload &&
          typeof payload === "object" &&
          (payload as { type?: string }).type === "chat_message" &&
          (payload as { clientMessageId?: string }).clientMessageId === clientMessageId,
        ),
    );
    firstSender.send(
      JSON.stringify({
        type: "chat_message",
        roomId: "main",
        clientMessageId,
        content: "只应出现一次",
      }),
    );
    const accepted = await firstDelivery;
    firstSender.close();

    const retrySender = await openSocket(url);
    const retryJoined = waitForMessage(retrySender, (payload): payload is { type: "join_ack" } =>
      Boolean(
        payload &&
        typeof payload === "object" &&
        (payload as { type?: string }).type === "join_ack",
      ),
    );
    joinChannel(retrySender, "retry-sender-b", "发送者", undefined, "duck", profileId);
    await retryJoined;
    const duplicateAck = waitForMessage(
      retrySender,
      (payload): payload is { type: "chat_ack"; messageId: string; duplicate: boolean } =>
        Boolean(
          payload &&
          typeof payload === "object" &&
          (payload as { type?: string }).type === "chat_ack" &&
          (payload as { clientMessageId?: string }).clientMessageId === clientMessageId,
        ),
    );
    retrySender.send(
      JSON.stringify({
        type: "chat_message",
        roomId: "main",
        clientMessageId,
        content: "只应出现一次",
      }),
    );
    const ack = await duplicateAck;
    await wait(120);
    assert.equal(ack.duplicate, true);
    assert.equal(ack.messageId, accepted.id);
    assert.deepEqual(receivedIds, [accepted.id]);
    retrySender.close();
  } finally {
    receiver.close();
    firstSender.close();
    await server.close();
  }
});

test("a restarted desktop replaces the stale peer with the same stable profile", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const previous = await openSocket(url);
  const restarted = await openSocket(url);
  const stableProfileId = "3be6f23c-2c54-4a8c-b67e-c6a45148aa85";

  try {
    const previousJoined = waitForMessage(
      previous,
      (payload): payload is { type: "join_ack" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "join_ack",
    );
    joinChannel(previous, "peer-before-restart", "同一个人", undefined, "fox", stableProfileId);
    await previousJoined;

    const restartedSnapshot = waitForMessage(
      restarted,
      (payload): payload is { type: "channel_snapshot"; members: Array<{ id: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: Array<{ id: string }> }).members?.length === 1,
    );
    joinChannel(restarted, "peer-after-restart", "同一个人", undefined, "fox", stableProfileId);
    await restartedSnapshot.then((snapshot) => {
      assert.deepEqual(
        snapshot.members.map((member) => member.id),
        ["peer-after-restart"],
      );
    });

    const health = (await fetch(`http://127.0.0.1:${port}/health`).then((response) =>
      response.json(),
    )) as { connectedPeers: number; occupiedAvatarIds: BuiltInAvatarId[] };
    assert.equal(health.connectedPeers, 1);
    assert.deepEqual(health.occupiedAvatarIds, ["fox"]);
  } finally {
    previous.close();
    restarted.close();
    await server.close();
  }
});

test("fixed channel reserves each built-in avatar atomically and releases it on leave", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const conflicting = await openSocket(url);
  const replacement = await openSocket(url);

  try {
    joinChannel(first, "avatar-first", "狐狸一号", undefined, "fox");
    await waitForMessage(
      first,
      (payload): payload is { type: "channel_snapshot"; members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 1,
    );

    joinChannel(conflicting, "avatar-conflict", "狐狸二号", undefined, "fox");
    const conflict = await waitForMessage(
      conflicting,
      (
        payload,
      ): payload is {
        type: "error";
        code: "avatar_taken";
        avatarId: BuiltInAvatarId;
        availableAvatarIds: BuiltInAvatarId[];
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "error" &&
        (payload as { code?: string }).code === "avatar_taken",
    );
    assert.equal(conflict.avatarId, "fox");
    assert.equal(conflict.availableAvatarIds.includes("fox"), false);
    assert.equal(conflict.availableAvatarIds.length, 4);

    const health = (await fetch(`http://127.0.0.1:${port}/health`).then((response) =>
      response.json(),
    )) as { occupiedAvatarIds: BuiltInAvatarId[] };
    assert.deepEqual(health.occupiedAvatarIds, ["fox"]);

    first.send(JSON.stringify({ type: "leave_channel", roomId: "main", peerId: "avatar-first" }));
    await wait(80);
    joinChannel(replacement, "avatar-replacement", "新狐狸", undefined, "fox");
    const joined = await waitForMessage(
      replacement,
      (payload): payload is { type: "join_ack" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "join_ack",
    );
    assert.equal(joined.type, "join_ack");
  } finally {
    first.close();
    conflicting.close();
    replacement.close();
    await server.close();
  }
});

test("fixed channel rejects an occupied avatar update without disconnecting the member", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const second = await openSocket(url);

  try {
    joinChannel(first, "avatar-owner", "小狐狸", undefined, "fox");
    await waitForMessage(
      first,
      (payload): payload is { type: "channel_snapshot"; members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 1,
    );
    joinChannel(second, "avatar-updater", "小猫", undefined, "cat");
    await waitForMessage(
      second,
      (payload): payload is { type: "channel_snapshot"; members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    second.send(
      JSON.stringify({
        type: "member_state",
        roomId: "main",
        peerId: "avatar-updater",
        avatarId: "fox",
      }),
    );
    const conflict = await waitForMessage(
      second,
      (payload): payload is { type: "error"; code: "avatar_taken" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "error" &&
        (payload as { code?: string }).code === "avatar_taken",
    );
    assert.equal(conflict.code, "avatar_taken");

    second.send(
      JSON.stringify({
        type: "request_snapshot",
        roomId: "main",
        peerId: "avatar-updater",
      }),
    );
    const snapshot = await waitForMessage(
      second,
      (
        payload,
      ): payload is {
        type: "channel_snapshot";
        members: Array<{ id: string; avatarId?: BuiltInAvatarId }>;
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot",
    );
    assert.equal(
      snapshot.members.find((member) => member.id === "avatar-updater")?.avatarId,
      "cat",
    );
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

test("fixed channel acknowledges join before sending the channel snapshot", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);
  const messageTypes: string[] = [];

  try {
    const snapshotReceived = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);
      socket.on("message", (raw) => {
        const payload = JSON.parse(raw.toString()) as {
          type?: string;
          peerId?: string;
          memberCount?: number;
        };
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

test("join acknowledgement provides short-lived TURN credentials when configured", async () => {
  const previousUrls = process.env.TURN_URLS;
  const previousSecret = process.env.TURN_SHARED_SECRET;
  const previousTtl = process.env.TURN_CREDENTIAL_TTL_SECONDS;
  process.env.TURN_URLS = "turn:127.0.0.1:3478?transport=udp,turn:127.0.0.1:3478?transport=tcp";
  process.env.TURN_SHARED_SECRET = "test-turn-secret";
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "3600";

  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const socket = await openSocket(`ws://127.0.0.1:${port}`);

  try {
    const acknowledgement = waitForMessage(
      socket,
      (
        payload,
      ): payload is {
        type: "join_ack";
        iceServers: Array<{ urls: string[]; username: string; credential: string }>;
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "join_ack",
    );
    joinChannel(socket, "turn-peer");
    const message = await acknowledgement;
    assert.deepEqual(message.iceServers[0]?.urls, [
      "turn:127.0.0.1:3478?transport=udp",
      "turn:127.0.0.1:3478?transport=tcp",
    ]);
    const username = message.iceServers[0]?.username;
    assert.match(username, /^\d+:turn-peer$/);
    assert.equal(
      message.iceServers[0]?.credential,
      createHmac("sha1", "test-turn-secret").update(username).digest("base64"),
    );

    const health = (await fetch(`http://127.0.0.1:${port}/health`).then((response) =>
      response.json(),
    )) as { turnConfigured: boolean };
    assert.equal(health.turnConfigured, true);
  } finally {
    socket.close();
    await server.close();
    if (previousUrls === undefined) delete process.env.TURN_URLS;
    else process.env.TURN_URLS = previousUrls;
    if (previousSecret === undefined) delete process.env.TURN_SHARED_SECRET;
    else process.env.TURN_SHARED_SECRET = previousSecret;
    if (previousTtl === undefined) delete process.env.TURN_CREDENTIAL_TTL_SECONDS;
    else process.env.TURN_CREDENTIAL_TTL_SECONDS = previousTtl;
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
    assert.equal(
      snapshot.members.some((member) => member.isHost),
      false,
    );
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

test("fixed channel keeps five peers on unique seats and broadcasts screen sharing", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sockets = await Promise.all(Array.from({ length: 5 }, () => openSocket(url)));

  try {
    for (let index = 0; index < sockets.length; index += 1) {
      const socket = sockets[index];
      if (!socket) continue;
      const expectedMemberCount = index + 1;
      const snapshotPromise = waitForMessage(
        sockets[0]!,
        (
          payload,
        ): payload is {
          members: Array<{ id: string; sceneZone?: string; presenceState?: string }>;
        } =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { type?: string }).type === "channel_snapshot" &&
          (payload as { members?: unknown[] }).members?.length === expectedMemberCount,
      );
      joinChannel(socket, `peer-${expectedMemberCount}`);
      await snapshotPromise;
    }

    const stableSnapshotPromise = waitForMessage(
      sockets[4]!,
      (
        payload,
      ): payload is {
        members: Array<{ id: string; sceneZone?: string; presenceState?: string }>;
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 5,
    );
    sockets[4]!.send(
      JSON.stringify({ type: "request_snapshot", roomId: "main", peerId: "peer-5" }),
    );
    const stableSnapshot = await stableSnapshotPromise;
    assert.equal(new Set(stableSnapshot.members.map((member) => member.id)).size, 5);
    assert.equal(new Set(stableSnapshot.members.map((member) => member.sceneZone)).size, 5);
    assert.equal(
      stableSnapshot.members.every((member) => member.presenceState === "online"),
      true,
    );

    const newestPeerOffers = Array.from({ length: 4 }, (_, index) =>
      waitForMessage(
        sockets[4]!,
        (payload): payload is { peerId: string; targetPeerId: string; sdp: { type: string } } =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { type?: string }).type === "peer_offer" &&
          (payload as { peerId?: string }).peerId === `peer-${index + 1}` &&
          (payload as { targetPeerId?: string }).targetPeerId === "peer-5",
      ),
    );
    for (let index = 0; index < 4; index += 1) {
      sockets[index]!.send(
        JSON.stringify({
          type: "peer_offer",
          roomId: "main",
          peerId: `peer-${index + 1}`,
          targetPeerId: "peer-5",
          sdp: { type: "offer", sdp: "v=0\r\n" },
        }),
      );
    }
    const forwardedOffers = await Promise.all(newestPeerOffers);
    assert.deepEqual(forwardedOffers.map((offer) => offer.peerId).sort(), [
      "peer-1",
      "peer-2",
      "peer-3",
      "peer-4",
    ]);

    const shareNotifications = sockets
      .slice(1)
      .map((socket) =>
        waitForMessage(
          socket,
          (payload): payload is { peerId: string; isSharing: boolean } =>
            typeof payload === "object" &&
            payload !== null &&
            (payload as { type?: string }).type === "screen_share_state" &&
            (payload as { peerId?: string }).peerId === "peer-1",
        ),
      );
    sockets[0]!.send(
      JSON.stringify({
        type: "screen_share_state",
        roomId: "main",
        peerId: "peer-1",
        isSharing: true,
      }),
    );
    const notifications = await Promise.all(shareNotifications);
    assert.equal(
      notifications.every((notification) => notification.isSharing),
      true,
    );
  } finally {
    for (const socket of sockets) socket.close();
    await server.close();
  }
});

test("fixed channel forwards peer media restart requests to the target only", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);

  try {
    joinChannel(sender, "restart-sender");
    await waitForMessage(
      sender,
      (payload): payload is { type: "channel_snapshot" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot",
    );
    joinChannel(receiver, "restart-receiver");
    await waitForMessage(
      sender,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    const forwarded = waitForMessage(
      receiver,
      (
        payload,
      ): payload is {
        type: "peer_restart_request";
        peerId: string;
        targetPeerId: string;
        reason: string;
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "peer_restart_request",
    );
    sender.send(
      JSON.stringify({
        type: "peer_restart_request",
        roomId: "main",
        peerId: "restart-sender",
        targetPeerId: "restart-receiver",
        reason: "connection_timeout",
      }),
    );
    const message = await forwarded;
    assert.equal(message.peerId, "restart-sender");
    assert.equal(message.targetPeerId, "restart-receiver");
    assert.equal(message.reason, "connection_timeout");
  } finally {
    sender.close();
    receiver.close();
    await server.close();
  }
});

test("fixed channel assigns unique seats and arbitrates simultaneous seat requests", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const second = await openSocket(url);

  try {
    joinChannel(first, "seat-first");
    await waitForMessage(
      first,
      (payload): payload is { type: string; members: Array<{ id: string; sceneZone?: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 1,
    );
    joinChannel(second, "seat-second");
    const joined = await waitForMessage(
      first,
      (payload): payload is { members: Array<{ id: string; sceneZone?: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );
    assert.equal(new Set(joined.members.map((member) => member.sceneZone)).size, 2);

    first.send(
      JSON.stringify({
        type: "member_state",
        roomId: "main",
        peerId: "seat-first",
        sceneZone: "gameDesk3",
        activity: "gaming",
        isMuted: false,
        isSpeaking: false,
        isDeafened: false,
      }),
    );
    await waitForMessage(
      second,
      (payload): payload is { peerId: string; sceneZone: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "member_state" &&
        (payload as { peerId?: string }).peerId === "seat-first" &&
        (payload as { sceneZone?: string }).sceneZone === "gameDesk3",
    );

    second.send(
      JSON.stringify({
        type: "member_state",
        roomId: "main",
        peerId: "seat-second",
        sceneZone: "gameDesk3",
        activity: "gaming",
        isMuted: false,
        isSpeaking: false,
        isDeafened: false,
      }),
    );
    const arbitrated = await waitForMessage(
      first,
      (payload): payload is { peerId: string; sceneZone: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "member_state" &&
        (payload as { peerId?: string }).peerId === "seat-second",
    );
    assert.notEqual(arbitrated.sceneZone, "gameDesk3");
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

test("fixed channel broadcasts text chat and knock events", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);

  try {
    joinChannel(sender, "sender", "小狐狸");
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

    const createdAt = "2000-01-01T00:00:00.000Z";
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
    assert.notEqual(knock.createdAt, createdAt);
  } finally {
    sender.close();
    receiver.close();
    await server.close();
  }
});

test("chat recall is authorized by the server and synchronized to every client", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);

  try {
    joinChannel(sender, "recall-sender", "小狐狸");
    joinChannel(receiver, "recall-receiver", "小熊");
    await waitForMessage(
      receiver,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    const senderMessage = waitForMessage(
      sender,
      (payload): payload is { type: "chat_message"; id: string; content: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_message" &&
        (payload as { content?: string }).content === "需要撤回",
    );
    const receiverMessage = waitForMessage(
      receiver,
      (payload): payload is { type: "chat_message"; id: string; content: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_message" &&
        (payload as { content?: string }).content === "需要撤回",
    );
    sender.send(JSON.stringify({ type: "chat_message", roomId: "main", content: "需要撤回" }));
    const [ownMessage, remoteMessage] = await Promise.all([senderMessage, receiverMessage]);
    assert.equal(ownMessage.id, remoteMessage.id);

    const senderRecall = waitForMessage(
      sender,
      (payload): payload is { type: "chat_recall"; messageId: string; peerId: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_recall",
    );
    const receiverRecall = waitForMessage(
      receiver,
      (payload): payload is { type: "chat_recall"; messageId: string; peerId: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "chat_recall",
    );
    sender.send(JSON.stringify({ type: "chat_recall", roomId: "main", messageId: ownMessage.id }));
    const [ownRecall, remoteRecall] = await Promise.all([senderRecall, receiverRecall]);
    assert.equal(ownRecall.messageId, ownMessage.id);
    assert.deepEqual(remoteRecall, ownRecall);
    assert.equal(ownRecall.peerId, "recall-sender");
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
        codec: "mulaw",
        data: "AAAA",
      }),
    );

    const chunk = await waitForMessage(
      receiver,
      (
        payload,
      ): payload is { sourcePeerId: string; data: string; codec: string; serverSequence: number } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "audio_chunk",
    );
    assert.equal(chunk.sourcePeerId, "sender");
    assert.equal(chunk.data, "AAAA");
    assert.equal(chunk.codec, "mulaw");
    assert.equal(typeof chunk.serverSequence, "number");
  } finally {
    sender.close();
    receiver.close();
    await server.close();
  }
});

test("fallback audio can target only the peers whose WebRTC audio path is stalled", async () => {
  const server = new SignalingServer({ roomName: "定向音频兜底" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const sender = await openSocket(url);
  const receiver = await openSocket(url);
  const bystander = await openSocket(url);
  const bystanderChunks: unknown[] = [];
  const onBystanderMessage = (raw: Buffer) => {
    const payload = JSON.parse(raw.toString()) as { type?: string };
    if (payload.type === "audio_chunk") bystanderChunks.push(payload);
  };
  bystander.on("message", onBystanderMessage);

  try {
    joinChannel(sender, "sender");
    joinChannel(receiver, "receiver");
    joinChannel(bystander, "bystander");
    await waitForMessage(
      bystander,
      (payload): payload is { members: unknown[] } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 3,
    );

    const targetedChunk = waitForMessage(
      receiver,
      (payload): payload is { sourcePeerId: string; targetPeerIds: string[]; data: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "audio_chunk",
    );
    sender.send(
      JSON.stringify({
        type: "audio_chunk",
        roomId: "main",
        peerId: "sender",
        sourcePeerId: "sender",
        audioSessionId: "session-targeted",
        audioStreamEpoch: 1,
        audioPath: "relay",
        sequence: 1,
        sentAt: Date.now(),
        durationMs: 40,
        sampleRate: 32_000,
        channelCount: 1,
        codec: "mulaw",
        targetPeerIds: ["receiver"],
        data: "AAAA",
      }),
    );

    const chunk = await targetedChunk;
    assert.equal(chunk.sourcePeerId, "sender");
    assert.deepEqual(chunk.targetPeerIds, ["receiver"]);
    await wait(120);
    assert.equal(bystanderChunks.length, 0);
  } finally {
    bystander.off("message", onBystanderMessage);
    sender.close();
    receiver.close();
    bystander.close();
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
        targetPeerIds: ["receiver"],
      }),
    );

    const frame = await waitForMessage(
      receiver,
      (
        payload,
      ): payload is {
        type: string;
        sourcePeerId: string;
        sequence: number;
        data: string;
        targetPeerIds?: string[];
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "screen_frame",
    );
    assert.equal(frame.sourcePeerId, "sender");
    assert.equal(frame.sequence, 7);
    assert.equal(frame.data, "data:image/jpeg;base64,AAAA");
    assert.deepEqual(frame.targetPeerIds, ["receiver"]);

    const pathRequest = waitForMessage(
      sender,
      (payload): payload is { type: string; peerId: string; needsRelay: boolean } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "screen_path_state",
    );
    receiver.send(
      JSON.stringify({
        type: "screen_path_state",
        roomId: "main",
        peerId: "receiver",
        targetPeerId: "sender",
        needsRelay: true,
        reason: "webrtc_screen_track_unavailable",
      }),
    );
    const requested = await pathRequest;
    assert.equal(requested.peerId, "receiver");
    assert.equal(requested.needsRelay, true);

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

    const peerAcknowledgement = waitForMessage(
      peer,
      (payload): payload is { type: "join_ack"; peerId: string; sessionToken: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "join_ack" &&
        (payload as { peerId?: string }).peerId === "peer" &&
        typeof (payload as { sessionToken?: unknown }).sessionToken === "string",
    );
    joinChannel(peer, "peer");
    const { sessionToken } = await peerAcknowledgement;
    const joined = await waitForMessage(
      first,
      (
        payload,
      ): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );

    peer.close();
    const reconnecting = await waitForMessage(
      first,
      (
        payload,
      ): payload is { revision: number; members: Array<{ id: string; presenceState: string }> } =>
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
    joinChannel(replacement, "peer", "peer", sessionToken);
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

test("fixed channel broadcasts lightweight scene reactions", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const url = `ws://127.0.0.1:${port}`;
  const first = await openSocket(url);
  const second = await openSocket(url);

  try {
    joinChannel(first, "fox", "橘子");
    await waitForMessage(
      first,
      (payload): payload is { type: "channel_snapshot" } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot",
    );
    joinChannel(second, "cat", "团团");
    await waitForMessage(
      first,
      (
        payload,
      ): payload is {
        type: "channel_snapshot";
        members: Array<{ id: string }>;
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "channel_snapshot" &&
        (payload as { members?: unknown[] }).members?.length === 2,
    );
    const reactionPromise = waitForMessage(
      second,
      (payload): payload is { type: "scene_reaction"; emoji: string } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "scene_reaction",
    );
    first.send(
      JSON.stringify({
        type: "scene_reaction",
        roomId: "main",
        peerId: "fox",
        targetPeerId: "cat",
        emoji: "🔥",
        createdAt: new Date().toISOString(),
      }),
    );
    assert.equal((await reactionPromise).emoji, "🔥");
  } finally {
    first.close();
    second.close();
    await server.close();
  }
});

test("late joiner can request and release one-way audio relay from every existing peer", async () => {
  const server = new SignalingServer({ roomName: "固定频道" });
  const port = await server.listen();
  const sockets = await Promise.all(
    Array.from({ length: 5 }, () => openSocket(`ws://127.0.0.1:${port}`)),
  );

  try {
    for (const [index, socket] of sockets.entries()) {
      const joined = waitForMessage(
        socket,
        (payload): payload is { type: "join_ack" } =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { type?: string }).type === "join_ack",
      );
      joinChannel(socket, `peer-${index + 1}`);
      await joined;
    }

    const lateJoiner = sockets[4]!;
    for (let index = 0; index < 4; index += 1) {
      const existingPeer = sockets[index]!;
      const targetPeerId = `peer-${index + 1}`;
      const requested = waitForMessage(
        existingPeer,
        (
          payload,
        ): payload is {
          type: "audio_path_state";
          peerId: string;
          targetPeerId: string;
          needsRelay: boolean;
        } =>
          typeof payload === "object" &&
          payload !== null &&
          (payload as { type?: string }).type === "audio_path_state",
      );
      lateJoiner.send(
        JSON.stringify({
          type: "audio_path_state",
          roomId: "main",
          peerId: "peer-5",
          targetPeerId,
          needsRelay: true,
          reason: "remote_audio_track_unavailable",
        }),
      );
      const request = await requested;
      assert.equal(request.peerId, "peer-5");
      assert.equal(request.targetPeerId, targetPeerId);
      assert.equal(request.needsRelay, true);
    }

    const released = waitForMessage(
      sockets[0]!,
      (
        payload,
      ): payload is {
        type: "audio_path_state";
        peerId: string;
        targetPeerId: string;
        needsRelay: boolean;
      } =>
        typeof payload === "object" &&
        payload !== null &&
        (payload as { type?: string }).type === "audio_path_state",
    );
    lateJoiner.send(
      JSON.stringify({
        type: "audio_path_state",
        roomId: "main",
        peerId: "peer-5",
        targetPeerId: "peer-1",
        needsRelay: false,
        reason: "remote_audio_track_playable",
      }),
    );
    assert.equal((await released).needsRelay, false);
  } finally {
    for (const socket of sockets) socket.close();
    await server.close();
  }
});
