import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { SignalingServer } from "@private-voice/signaling";
import { APP_PROTOCOL_VERSION, APP_BUILD_NUMBER, BUILT_IN_AVATAR_IDS } from "@private-voice/shared";
import { WebSocket } from "ws";

const waitFor = (socket: WebSocket, predicate: (value: Record<string, unknown>) => boolean) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", receive);
      reject(new Error("league_presence_timeout"));
    }, 4000);
    const receive = (raw: Buffer) => {
      const value = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (predicate(value)) {
        clearTimeout(timer);
        socket.off("message", receive);
        resolve(value);
      }
    };
    socket.on("message", receive);
  });

test("real signaling keeps League details for late joiners, preserves mute patches and clears another game's stale party", async () => {
  const server = new SignalingServer({ roomName: "league-integration" });
  const port = await server.listen();
  const sockets: WebSocket[] = [];
  const join = async (id: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    await once(socket, "open");
    const snapshot = waitFor(
      socket,
      (value) => value.type === "room_snapshot" || value.type === "channel_snapshot",
    );
    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: "main",
        channelId: "main",
        peerId: id,
        nickname: id,
        avatarId: BUILT_IN_AVATAR_IDS[sockets.length - 1],
        appVersion: "test",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
      }),
    );
    return { socket, snapshot: await snapshot };
  };
  try {
    const a = await join("league-A"),
      b = await join("league-B");
    const session = {
      source: "league",
      phase: "lobby",
      mode: "排位赛",
      partySize: 2,
      partyCapacity: 5,
    };
    const rich = waitFor(
      b.socket,
      (value) =>
        value.type === "member_state" &&
        value.peerId === "league-A" &&
        value.gameSession !== undefined,
    );
    a.socket.send(
      JSON.stringify({
        type: "member_state",
        roomId: "main",
        peerId: "league-A",
        gameName: "英雄联盟",
        gameSession: session,
      }),
    );
    assert.deepEqual((await rich).gameSession, session);
    const muted = waitFor(
      b.socket,
      (value) =>
        value.type === "member_state" && value.peerId === "league-A" && value.isMuted === true,
    );
    a.socket.send(
      JSON.stringify({ type: "member_state", roomId: "main", peerId: "league-A", isMuted: true }),
    );
    await muted;
    const c = await join("league-C");
    const members = c.snapshot.members as { id: string; gameSession?: unknown }[];
    assert.deepEqual(members.find((member) => member.id === "league-A")?.gameSession, session);
    const cleared = waitFor(
      b.socket,
      (value) =>
        value.type === "member_state" &&
        value.peerId === "league-A" &&
        value.gameName === "我的世界",
    );
    a.socket.send(
      JSON.stringify({
        type: "member_state",
        roomId: "main",
        peerId: "league-A",
        gameName: "我的世界",
      }),
    );
    assert.equal((await cleared).gameSession, null);
    const d = await join("league-D");
    assert.equal(
      (d.snapshot.members as { id: string; gameSession?: unknown }[]).find(
        (member) => member.id === "league-A",
      )?.gameSession,
      undefined,
    );
  } finally {
    for (const socket of sockets) socket.terminate();
    await server.close();
  }
});
