import { SignalingServer } from "../../../../packages/signaling/dist/index.js";
import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "../../../../packages/shared/dist/index.js";
import { WebSocket } from "ws";

const port = Number(process.env.SHANGHAO_FIXTURE_PORT || "43829");
const remoteCount = Math.max(0, Math.min(4, Number(process.env.SHANGHAO_FIXTURE_REMOTES || "0")));
const fixtureOffset = Math.max(0, Math.min(4, Number(process.env.SHANGHAO_FIXTURE_OFFSET || "0")));
const server = new SignalingServer({ port, roomName: "2.7.0 视觉验证" });
await server.listen();

const fixtures = [
  ["grampus", "corgi"],
  ["seven", "cat"],
  ["朋友中文昵称", "panda"],
  ["FifthFriend", "fox"],
];
const sockets = [];
const send = (socket, payload) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};
for (let index = 0; index < remoteCount; index += 1) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const fixtureIndex = (index + fixtureOffset) % fixtures.length;
  const [nickname, avatarId] = fixtures[fixtureIndex];
  const peerId = `visual-peer-${fixtureIndex + 1}`;
  send(socket, {
    type: "join_channel",
    roomId: "main",
    channelId: "main",
    peerId,
    profileId: `00000000-0000-4000-8000-00000000000${fixtureIndex + 1}`,
    nickname,
    avatarId,
    appVersion: "2.7.0",
    protocolVersion: APP_PROTOCOL_VERSION,
    buildNumber: APP_BUILD_NUMBER,
  });
  const heartbeat = setInterval(
    () => send(socket, { type: "heartbeat", roomId: "main", peerId, sentAt: Date.now() }),
    5_000,
  );
  socket.on("close", () => clearInterval(heartbeat));
  sockets.push(socket);
}

console.log(JSON.stringify({ ready: true, port, remoteCount }));
const shutdown = async () => {
  for (const socket of sockets) socket.close();
  await server.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
setInterval(() => undefined, 60_000);
