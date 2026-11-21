import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "../../../packages/signaling/src/server";
import { DailyRoomReportStore } from "../../../packages/signaling/src/daily-room-report-store";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function receive(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout:${type}`));
    }, 4000);
    const onMessage = (data: Buffer) => {
      const value = JSON.parse(data.toString()) as Record<string, unknown>;
      if (value.type === type) {
        cleanup();
        resolve(value);
      }
    };
    socket.on("message", onMessage);
  });
}

test("real signaling chronicle controls stay within the joined room", async () => {
  const server = new SignalingServer({
    roomName: "合成纪事测试",
    chronicleServices: {
      speechService: {
        isConfigured: () => true,
        transcribe: async () => ({ text: "合成测试", modelName: "fixture" }),
      },
      textService: { isConfigured: () => true, execute: async () => '{"text":"合成测试纪事"}' },
    },
  });
  const port = await server.listen();
  const sockets: WebSocket[] = [];
  try {
    for (const [roomId, peerId, avatarId] of [
      ["main", "a", "fox"],
      ["side", "b", "cat"],
    ]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      const joined = receive(socket, "join_ack");
      socket.send(
        JSON.stringify({
          type: "join_channel",
          roomId,
          channelId: roomId,
          peerId,
          nickname: peerId,
          avatarId,
          appVersion: "3.4.16",
          protocolVersion: APP_PROTOCOL_VERSION,
          buildNumber: APP_BUILD_NUMBER,
        }),
      );
      await joined;
    }
    const main = sockets[0]!;
    const side = sockets[1]!;
    const started = receive(main, "chronicle_state");
    main.send(
      JSON.stringify({ type: "chronicle_control", roomId: "main", peerId: "a", action: "start" }),
    );
    const state = (await started).state as { sessionId: string; participants: string[] };
    assert.ok(state.sessionId);
    assert.deepEqual(state.participants, ["a"]);
    const read = receive(side, "chronicle_state");
    side.send(
      JSON.stringify({ type: "chronicle_control", roomId: "side", peerId: "b", action: "read" }),
    );
    assert.equal((await read).state, undefined);
    const changed = receive(main, "chronicle_state");
    main.send(
      JSON.stringify({
        type: "chronicle_control",
        roomId: "main",
        peerId: "a",
        action: "participate",
        sessionId: state.sessionId,
        enabled: true,
      }),
    );
    assert.deepEqual(((await changed).state as { participants: string[] }).participants, ["a"]);
  } finally {
    sockets.forEach((socket) => socket.terminate());
    await server.close();
  }
});

test(
  "a fresh join receives only its own persisted day and sees the midnight reset without leaving",
  { timeout: 8_000 },
  async (t) => {
    const before = Date.parse("2026-11-20T23:59:58+08:00");
    const midnight = Date.parse("2026-11-21T00:00:00+08:00");
    t.mock.timers.enable({ apis: ["Date"], now: before });
    const directory = await mkdtemp(path.join(os.tmpdir(), "chronicle-today-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "reports.json");
    const store = await DailyRoomReportStore.create(file);
    for (let i = 0; i < 33; i++)
      store.publishChronicleRecap(
        "main",
        `main-${i}`,
        `今天的纪事 ${i}`,
        before - 60_000 + i,
        before,
      );
    store.publishChronicleRecap("main", "old", "昨日纪事", before - 86_400_000, before);
    store.publishChronicleRecap("side", "side", "另一个房间", before - 20_000, before);
    await store.flush();
    const server = new SignalingServer({ roomName: "合成测试", dailyRoomReportFile: file });
    const sockets: WebSocket[] = [];
    try {
      const port = await server.listen();
      const join = async (roomId: string, peerId: string, pages: number) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`);
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
          socket.once("open", resolve);
          socket.once("error", reject);
        });
        const received: Record<string, unknown>[] = [];
        const history = new Promise<void>((resolve) => {
          socket.on("message", (data) => {
            const packet = JSON.parse(data.toString()) as Record<string, unknown>;
            if (packet.type !== "chronicle_history") return;
            received.push(packet);
            if (received.length === pages) resolve();
          });
        });
        const joined = receive(socket, "join_ack");
        socket.send(
          JSON.stringify({
            type: "join_channel",
            roomId,
            channelId: roomId,
            peerId,
            nickname: peerId,
            avatarId: "fox",
            appVersion: "3.4.22",
            protocolVersion: APP_PROTOCOL_VERSION,
            buildNumber: APP_BUILD_NUMBER,
          }),
        );
        assert.equal((await joined).chronicleDay, "2026-11-20");
        await history;
        return { socket, received };
      };
      const main = await join("main", "viewer", 2);
      assert.equal(main.received[0]?.replace, true);
      assert.equal(main.received[1]?.replace, undefined);
      assert.deepEqual(
        main.received.flatMap((packet) => (packet.entries as { id: string }[]).map(({ id }) => id)),
        Array.from({ length: 33 }, (_, index) => `main-${index}`),
      );
      const side = await join("side", "neighbor", 1);
      assert.deepEqual(
        (side.received[0]?.entries as { id: string }[]).map(({ id }) => id),
        ["side"],
      );
      const rollover = receive(main.socket, "chronicle_history");
      t.mock.timers.setTime(midnight);
      assert.deepEqual(await rollover, {
        type: "chronicle_history",
        roomId: "main",
        date: "2026-11-21",
        replace: true,
        entries: [],
      });
    } finally {
      sockets.forEach((socket) => socket.terminate());
      await server.close();
    }
  },
);
