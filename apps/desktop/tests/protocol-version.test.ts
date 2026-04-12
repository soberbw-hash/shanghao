import assert from "node:assert/strict";
import test from "node:test";

import { APP_BUILD_NUMBER } from "@private-voice/shared";
import { SignalingServer } from "@private-voice/signaling";
import { WebSocket } from "ws";

test("signaling server rejects mismatched protocol versions with a clear error", async () => {
  const server = new SignalingServer({ roomName: "测试房间" });
  const port = await server.listen();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);

  await new Promise((resolve) => socket.once("open", resolve));

  const errorMessagePromise = new Promise<{ code: string; message: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("message_timeout")), 4_000);

    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString()) as { type?: string; code?: string; message?: string };
      if (payload.type === "error") {
        clearTimeout(timer);
        resolve({
          code: payload.code || "unknown",
          message: payload.message || "",
        });
      }
    });
    socket.on("error", reject);
  });

  socket.send(
    JSON.stringify({
      type: "join_room",
      roomId: "version-mismatch-room",
      peerId: "peer-1",
      nickname: "成员",
      appVersion: "0.1.7",
      protocolVersion: "999",
      buildNumber: APP_BUILD_NUMBER,
      connectionMode: "direct_host",
    }),
  );

  const errorMessage = await errorMessagePromise;

  assert.equal(errorMessage.code, "version_mismatch");
  assert.match(errorMessage.message, /版本不一致/);

  socket.close();
  await server.close();
});
