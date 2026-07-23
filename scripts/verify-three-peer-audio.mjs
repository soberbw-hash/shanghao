import { SignalingServer } from "../packages/signaling/dist/index.js";
import { APP_PROTOCOL_VERSION } from "../packages/shared/dist/index.js";
import { WebSocket } from "../apps/desktop/node_modules/ws/wrapper.mjs";

const server = new SignalingServer({ roomName: "five-peer-audio-check" });
const port = await server.listen();
const url = `ws://127.0.0.1:${port}`;
const peerIds = ["A", "B", "C", "D", "E"];
const peers = new Map();
const received = Object.fromEntries(peerIds.map((peerId) => [peerId, []]));
const sourceSequences = Object.fromEntries(peerIds.map((peerId) => [peerId, 0]));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const openPeer = async (peerId) => {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== "audio_chunk") return;
    received[peerId].push({
      sourcePeerId: message.sourcePeerId,
      sequence: message.sequence,
      targetPeerIds: message.targetPeerIds,
      serverSequence: message.serverSequence,
      serverReceivedAt: message.serverReceivedAt,
      serverForwardedAt: message.serverForwardedAt,
    });
  });
  socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId: "main",
      channelId: "main",
      peerId,
      nickname: peerId,
      avatarId: "fox",
      appVersion: "dev",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: "five-peer-check",
    }),
  );
  peers.set(peerId, socket);
  return socket;
};

const sendToneFrame = (sourcePeerId, targetPeerId) => {
  sourceSequences[sourcePeerId] += 1;
  peers.get(sourcePeerId).send(
    JSON.stringify({
      type: "audio_chunk",
      roomId: "main",
      peerId: sourcePeerId,
      sourcePeerId,
      audioSessionId: `session-${sourcePeerId}`,
      audioStreamEpoch: 1,
      audioPath: "relay",
      sequence: sourceSequences[sourcePeerId],
      sentAt: Date.now(),
      capturedAtMonotonic: performance.now(),
      durationMs: 40,
      sampleRate: 32_000,
      channelCount: 1,
      codec: "mulaw",
      targetPeerIds: [targetPeerId],
      data: "AAAA",
    }),
  );
};

const verifyFullMesh = () => {
  const failures = [];
  for (const receiver of peerIds) {
    const frames = received[receiver];
    for (const source of peerIds.filter((peerId) => peerId !== receiver)) {
      const routeFrames = frames.filter((frame) => frame.sourcePeerId === source);
      if (routeFrames.length !== 1) {
        failures.push(`${source}->${receiver}: expected 1 frame, received ${routeFrames.length}`);
      }
      if (routeFrames.some((frame) => !frame.targetPeerIds?.includes(receiver))) {
        failures.push(`${source}->${receiver}: target metadata missing`);
      }
    }
    if (frames.length !== peerIds.length - 1) {
      failures.push(`${receiver}: expected 4 total frames, received ${frames.length}`);
    }
  }
  return failures;
};

try {
  // Stagger joins to reproduce the real late-join order that previously left
  // the fourth or fifth member with a one-way audio graph.
  for (const peerId of peerIds) {
    await openPeer(peerId);
    await wait(80);
  }
  await wait(200);

  // Exercise every directed route in a five-person room (20 total paths).
  for (const source of peerIds) {
    for (const target of peerIds) {
      if (source !== target) sendToneFrame(source, target);
    }
  }
  await wait(500);
  const failedPeerPairs = verifyFullMesh();

  // Rejoin the last peer and ensure both directions recover after its socket is
  // replaced. This mirrors a brief network loss without disturbing A-D.
  peers.get("E").send(JSON.stringify({ type: "leave_channel", roomId: "main", peerId: "E" }));
  peers.get("E").close();
  peers.delete("E");
  await wait(120);
  await openPeer("E");
  await wait(220);
  const beforeE = received.E.length;
  const beforeA = received.A.length;
  sendToneFrame("A", "E");
  sendToneFrame("E", "A");
  await wait(300);
  if (received.E.length !== beforeE + 1) failedPeerPairs.push("A->E after E rejoined");
  if (received.A.length !== beforeA + 1) failedPeerPairs.push("E->A after E rejoined");

  const result = {
    expectedPeerCount: peerIds.length,
    directedRoutesChecked: peerIds.length * (peerIds.length - 1),
    perPeerReceivedAudio: Object.fromEntries(
      Object.entries(received).map(([peerId, frames]) => [peerId, frames.length]),
    ),
    lateJoinAndReconnectChecked: true,
    targetedRelayChecked: true,
    failedPeerPairs,
    relayFallbackStatus: failedPeerPairs.length === 0 ? "passed" : "failed",
    note: "WebRTC RTP liveness and shared AudioContext playback are covered by desktop smoke tests.",
  };
  console.log(JSON.stringify(result, null, 2));
  if (failedPeerPairs.length > 0) process.exitCode = 1;
} finally {
  for (const socket of peers.values()) socket.close();
  await server.close();
}
