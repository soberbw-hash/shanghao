import assert from "node:assert/strict";
import test from "node:test";

import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";
import { WebSocket } from "ws";

test("signaling server rejects mismatched protocol versions with a clear error", async () => {
  const server = new SignalingServer({ roomName: "测试房间" });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await new Promise((resolve) => socket.once("open", resolve));

    const errorMessagePromise = new Promise<{ code: string; message: string }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);

        socket.on("message", (raw) => {
          const payload = JSON.parse(raw.toString()) as {
            type?: string;
            code?: string;
            message?: string;
          };
          if (payload.type === "error") {
            clearTimeout(timer);
            resolve({
              code: payload.code || "unknown",
              message: payload.message || "",
            });
          }
        });
        socket.on("error", reject);
      },
    );

    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: "main",
        channelId: "main",
        peerId: "peer-1",
        nickname: "成员",
        avatarId: "fox",
        appVersion: "0.1.7",
        protocolVersion: "999",
        buildNumber: APP_BUILD_NUMBER,
      }),
    );

    const errorMessage = await errorMessagePromise;

    assert.equal(errorMessage.code, "version_mismatch");
    assert.match(errorMessage.message, /当前版本太旧/);
  } finally {
    socket.close();
    await server.close();
  }
});

test("signaling server accepts a different build number when protocol is compatible", async () => {
  const server = new SignalingServer({ roomName: "测试房间" });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);

  try {
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const acknowledgementPromise = new Promise<{
      type: "join_ack";
      peerId: string;
      buildNumber: string;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);
      socket.on("message", (raw) => {
        const payload = JSON.parse(raw.toString()) as {
          type?: string;
          peerId?: string;
          buildNumber?: string;
        };
        if (payload.type === "join_ack") {
          clearTimeout(timer);
          resolve(payload as { type: "join_ack"; peerId: string; buildNumber: string });
        }
      });
      socket.on("error", reject);
    });

    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: "main",
        channelId: "main",
        peerId: "compatible-peer",
        nickname: "成员",
        avatarId: "fox",
        appVersion: "0.1.49",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: "older-compatible-build",
      }),
    );

    const acknowledgement = await acknowledgementPromise;
    assert.equal(acknowledgement.peerId, "compatible-peer");
    assert.equal(acknowledgement.buildNumber, APP_BUILD_NUMBER);
  } finally {
    socket.close();
    await server.close();
  }
});
