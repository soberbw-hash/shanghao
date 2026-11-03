import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "../../../packages/signaling/src/server";
import type { ReplaySnapshot } from "../../../packages/signaling/src/room-replay-consent";

function receive(socket: WebSocket, match: (message: Record<string, unknown>) => boolean) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("message", listener);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(Error("replay_test_timeout"));
    }, 3000);
    const listener = (bytes: Buffer) => {
      const message = JSON.parse(bytes.toString()) as Record<string, unknown>;
      if (match(message)) {
        cleanup();
        resolve(message);
      }
    };
    socket.on("message", listener);
  });
}

test("WebSocket replay consent survives rate-limit pressure, cannot approve another peer, resets on join", async () => {
  const server = new SignalingServer({ roomName: "回溯测试" });
  const port = await server.listen(),
    sockets: WebSocket[] = [];
  const join = async (peerId: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    await new Promise<void>((resolve) => socket.once("open", resolve));
    const ack = receive(socket, (m) => m.type === "join_ack");
    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: "main",
        channelId: "main",
        peerId,
        nickname: peerId,
        avatarId: peerId === "one" ? "fox" : peerId === "two" ? "cat" : "duck",
        appVersion: "3.4.16",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
      }),
    );
    assert.equal((await ack).replaySupported, true);
    return socket;
  };
  try {
    const one = await join("one"),
      two = await join("two");
    const started = receive(one, (m) => m.type === "replay_state");
    one.send(
      JSON.stringify({ type: "replay_control", roomId: "main", peerId: "one", action: "start" }),
    );
    const state = (await started).state as ReplaySnapshot;
    assert.deepEqual(state.approved, ["one"]);
    const forged = receive(one, (m) => m.type === "replay_state");
    one.send(
      JSON.stringify({
        type: "replay_control",
        roomId: "main",
        peerId: "two",
        action: "approve",
        sessionId: state.sessionId,
        epoch: state.epoch,
      }),
    );
    assert.equal(((await forged).state as ReplaySnapshot).enabled, false);
    const enabled = receive(
      one,
      (m) => m.type === "replay_state" && (m.state as ReplaySnapshot)?.enabled === true,
    );
    two.send(
      JSON.stringify({
        type: "replay_control",
        roomId: "main",
        peerId: "two",
        action: "approve",
        sessionId: state.sessionId,
        epoch: state.epoch,
      }),
    );
    await enabled;
    // Exhaust regular control budget. A consent withdrawal must still be applied.
    for (let i = 0; i < 25; i++)
      two.send(
        JSON.stringify({ type: "replay_control", roomId: "main", peerId: "two", action: "read" }),
      );
    const revoked = receive(
      one,
      (m) => m.type === "replay_state" && (m.state as ReplaySnapshot)?.approved.length === 1,
    );
    two.send(
      JSON.stringify({
        type: "replay_control",
        roomId: "main",
        peerId: "two",
        action: "revoke",
        sessionId: state.sessionId,
        epoch: state.epoch,
      }),
    );
    assert.equal(((await revoked).state as ReplaySnapshot).enabled, false);
    const reset = receive(
      one,
      (m) => m.type === "replay_state" && (m.state as ReplaySnapshot)?.epoch === state.epoch + 1,
    );
    await join("three");
    assert.deepEqual(((await reset).state as ReplaySnapshot).approved, []);
  } finally {
    sockets.forEach((socket) => socket.terminate());
    await server.close();
  }
});
