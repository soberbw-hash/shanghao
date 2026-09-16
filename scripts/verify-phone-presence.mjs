import assert from "node:assert/strict";
import { once } from "node:events";
import { SignalingServer } from "../packages/signaling/dist/index.js";
import { APP_PROTOCOL_VERSION } from "../packages/shared/dist/index.js";
import { WebSocket } from "../apps/desktop/node_modules/ws/wrapper.mjs";
const server = new SignalingServer({ roomName: "phone-mode-check" });
const port = await server.listen();
const sockets = [];
const waitMessage = (socket, predicate) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", receive);
      reject(new Error("Presence timeout"));
    }, 5000);
    function receive(raw) {
      const value = JSON.parse(raw.toString());
      if (predicate(value)) {
        clearTimeout(timeout);
        socket.off("message", receive);
        resolve(value);
      }
    }
    socket.on("message", receive);
  });
async function join(id, avatarId) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  await once(socket, "open");
  const snapshot = waitMessage(
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
      avatarId,
      appVersion: "dev",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: "phone-check",
    }),
  );
  return { socket, snapshot: await snapshot };
}
try {
  const a = await join("phone-A", "fox"),
    b = await join("phone-B", "cat");
  const entering = waitMessage(
    b.socket,
    (value) =>
      value.type === "member_state" && value.peerId === "phone-A" && value.callModeActive === true,
  );
  a.socket.send(
    JSON.stringify({
      type: "member_state",
      roomId: "main",
      peerId: "phone-A",
      callModeActive: true,
    }),
  );
  await entering;
  const c = await join("phone-C", "duck");
  assert.equal(c.snapshot.members.find((value) => value.id === "phone-A").callModeActive, true);
  const leaving = waitMessage(
    c.socket,
    (value) =>
      value.type === "member_state" && value.peerId === "phone-A" && value.callModeActive === false,
  );
  a.socket.send(
    JSON.stringify({
      type: "member_state",
      roomId: "main",
      peerId: "phone-A",
      callModeActive: false,
    }),
  );
  await leaving;
  console.log(
    JSON.stringify({
      livePresence: true,
      lateJoinSnapshot: true,
      exitPresence: true,
      remoteServerDeployed: false,
    }),
  );
} finally {
  for (const socket of sockets) socket.terminate();
  await server.close();
}
