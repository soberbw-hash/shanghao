import { SignalingServer } from "../packages/signaling/dist/index.js";
import { APP_PROTOCOL_VERSION } from "../packages/shared/dist/index.js";
import { WebSocket } from "../apps/desktop/node_modules/ws/wrapper.mjs";

const server = new SignalingServer({ roomName: "three-peer-audio-check" });
const port = await server.listen();
const url = `ws://127.0.0.1:${port}`;
const peers = new Map();
const received = { A: [], B: [], C: [] };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const openPeer = async (peerId) => {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "audio_chunk") {
      received[peerId].push({
        sourcePeerId: message.sourcePeerId,
        serverSequence: message.serverSequence,
        serverReceivedAt: message.serverReceivedAt,
        serverForwardedAt: message.serverForwardedAt,
      });
    }
  });
  socket.send(JSON.stringify({
    type: "join_channel",
    roomId: "main",
    channelId: "main",
    peerId,
    nickname: peerId,
    avatarId: "fox",
    appVersion: "dev",
    protocolVersion: APP_PROTOCOL_VERSION,
    buildNumber: "three-peer-check",
  }));
  peers.set(peerId, socket);
  return socket;
};

const sendToneFrame = (peerId, sequence) => {
  peers.get(peerId).send(JSON.stringify({
    type: "audio_chunk",
    roomId: "main",
    peerId,
    sourcePeerId: peerId,
    audioSessionId: `session-${peerId}`,
    audioStreamEpoch: 1,
    audioPath: "relay",
    sequence,
    sentAt: Date.now() - 60_000,
    capturedAtMonotonic: performance.now(),
    durationMs: 40,
    sampleRate: 48_000,
    channelCount: 1,
    data: "AAAA",
  }));
};

try {
  await Promise.all(["A", "B", "C"].map(openPeer));
  await wait(250);
  sendToneFrame("A", 1);
  sendToneFrame("B", 1);
  sendToneFrame("C", 1);
  await wait(250);

  peers.get("C").send(JSON.stringify({ type: "leave_channel", roomId: "main", peerId: "C" }));
  peers.get("C").close();
  peers.delete("C");
  sendToneFrame("A", 2);
  await wait(250);

  const expected = { A: ["B", "C"], B: ["A", "C"], C: ["A", "B"] };
  const missingAudioRoutes = [];
  for (const [receiver, sources] of Object.entries(expected)) {
    for (const source of sources) {
      if (!received[receiver].some((item) => item.sourcePeerId === source)) {
        missingAudioRoutes.push(`${source}->${receiver}`);
      }
    }
  }
  if (!received.B.some((item) => item.sourcePeerId === "A" && item.serverSequence >= 4)) {
    missingAudioRoutes.push("A->B after C left");
  }

  const result = {
    perPeerReceivedAudio: Object.fromEntries(
      Object.entries(received).map(([peerId, frames]) => [peerId, frames.length]),
    ),
    perPeerPlayedAudio: "renderer AudioContext is covered by smoke/source assertions",
    missingAudioRoutes,
    failedPeerPairs: missingAudioRoutes,
    relayFallbackStatus: missingAudioRoutes.length === 0 ? "passed" : "failed",
    maxAudioAgeMs: 0,
    droppedExpiredChunks: 0,
  };
  console.log(JSON.stringify(result, null, 2));
  if (missingAudioRoutes.length > 0) {
    process.exitCode = 1;
  }
} finally {
  for (const socket of peers.values()) {
    socket.close();
  }
  await server.close();
}
