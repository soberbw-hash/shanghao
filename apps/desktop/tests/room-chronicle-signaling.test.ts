import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "../../../packages/signaling/src/server";

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
