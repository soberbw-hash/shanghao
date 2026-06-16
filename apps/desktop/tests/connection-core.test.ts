import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("webrtc prefers domestic stun and buffers early ICE candidates", () => {
  const source = read("packages/webrtc/src/createPeer.ts");

  assert.equal(source.includes("stun:stun.qq.com:3478"), true);
  assert.equal(source.includes("stun:stun.miwifi.com:3478"), true);
  assert.equal(source.includes("stun:stun.chat.bilibili.com:3478"), true);
  assert.equal(source.includes("pendingIceCandidates"), true);
  assert.equal(source.includes("flushPendingIceCandidates"), true);
});

test("room client marks webrtc ready from connection state instead of remote stream", () => {
  const source = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const relay = read("apps/desktop/src/renderer/src/features/room/signalingAudioRelay.ts");

  assert.equal(source.includes('if (state === "connected")'), true);
  assert.equal(source.includes("this.webrtcReadyPeerIds.add(targetPeerId)"), true);
  assert.equal(source.includes('this.audioRelay?.markPeerPath(targetPeerId, "webrtc", "webrtc_connected")'), true);
  assert.equal(source.includes('state === "closed"'), true);
  assert.equal(relay.includes("MAX_PACKET_AGE_MS = 8_000"), true);
  assert.equal(relay.includes("MAX_QUEUE_DURATION_MS = 3_000"), true);
  assert.equal(relay.includes("MAX_QUEUE_CHUNKS = 80"), true);
  assert.equal(relay.includes("droppedExpiredChunks"), true);
  assert.equal(relay.includes("serverClockOffsetMs"), true);
  assert.equal(relay.includes("audioStreamEpoch"), true);
  assert.equal(relay.includes("audio_resync_request"), true);
  assert.equal(relay.includes("this.context.currentTime"), true);
});

test("tailscale selects 100.x before MagicDNS", () => {
  const source = read("apps/desktop/src/main/tailscale.ts");
  const ipBranch = source.indexOf("if (tailscale.ip)");
  const dnsBranch = source.indexOf("if (tailscale.magicDnsName");

  assert.equal(ipBranch >= 0, true);
  assert.equal(dnsBranch > ipBranch, true);
  assert.equal(source.includes('backendState === "needslogin"'), true);
  assert.equal(source.includes('backendState === "stopped"'), true);
});

test("cloudflare tunnel mode is wired into shared types and host lifecycle", () => {
  const settingsTypes = read("packages/shared/src/types/settings.types.ts");
  const hostSession = read("apps/desktop/src/main/host-session.ts");
  const tunnel = read("apps/desktop/src/main/cloudflare-tunnel.ts");

  assert.equal(settingsTypes.includes('"cloudflare_tunnel"'), true);
  assert.equal(hostSession.includes('connectionMode === "cloudflare_tunnel"'), true);
  assert.equal(hostSession.includes("this.cloudflareTunnel.start(signalingPort)"), true);
  assert.equal(hostSession.includes("this.cloudflareTunnel?.stop()"), true);
  assert.equal(tunnel.includes("trycloudflare"), true);
  assert.equal(tunnel.includes("Cloudflare quick tunnel exited unexpectedly"), true);
  assert.equal(tunnel.includes("HEALTH_CHECK_INTERVAL_MS = 20_000"), true);
  assert.equal(tunnel.includes("MAX_HEALTH_FAILURES = 3"), true);
  assert.equal(tunnel.includes("Cloudflare quick tunnel health recovered"), true);
});

test("relay status checks both health endpoint and websocket", () => {
  const relayStatus = read("apps/desktop/src/main/relay-status.ts");

  assert.equal(relayStatus.includes('healthUrl.pathname = "/health"'), true);
  assert.equal(relayStatus.includes("probeHealth(normalizedUrl)"), true);
  assert.equal(relayStatus.includes("probeWebSocket(normalizedUrl)"), true);
  assert.equal(relayStatus.includes("const isReachable = isWebSocketReachable"), true);
});

test("room client preserves peers while signaling reconnects and bounds retry attempts", () => {
  const source = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const hook = read("apps/desktop/src/renderer/src/hooks/useRoomState.ts");

  assert.equal(source.includes("MAX_RECONNECT_ATTEMPTS = 6"), true);
  assert.equal(source.includes("this.options.onReconnectExhausted?.(error)"), true);
  assert.equal(source.includes("Ignored stale room snapshot"), true);
  assert.equal(source.includes("snapshot.revision <= this.lastSnapshotRevision"), true);
  assert.equal(source.includes("this.clearPeers();\n      this.reconnect();"), false);
  assert.equal(hook.includes("cleanupPreviousSession"), true);
  assert.equal(hook.includes("peerId: sharedPeerId"), false);
});

test("audio backpressure drops realtime frames instead of queueing stale audio", () => {
  const bridge = read("apps/desktop/src/main/signaling-client.ts");
  assert.equal(bridge.includes("bufferedAmount >= 512 * 1024"), true);
  assert.equal(bridge.includes("droppedByBackpressure"), true);
  assert.equal(bridge.includes("maxBufferedAmount"), true);
});

test("room joining uses acknowledgement and snapshot recovery without logging raw signaling data", () => {
  const client = read("apps/desktop/src/renderer/src/features/room/roomClient.ts");
  const hook = read("apps/desktop/src/renderer/src/hooks/useRoomState.ts");
  const diagnostics = read("apps/desktop/src/main/diagnostics.ts");

  assert.equal(client.includes('case "join_ack"'), true);
  assert.equal(client.includes('type: "request_snapshot"'), true);
  assert.equal(client.includes("RoomConnectionState.WaitingSnapshot"), true);
  assert.equal(client.includes('new Error(this.wsOpened ? "join_ack_timeout"'), true);
  assert.equal(hook.includes("summarizeSignalingEvent"), true);
  assert.equal(hook.includes("...payload,"), false);
  assert.equal(diagnostics.includes("MAX_LOG_FILE_BYTES"), true);
  assert.equal(diagnostics.includes("EXPORT_LOG_TAIL_BYTES"), true);
  assert.equal(diagnostics.includes('"log-stats.json"'), true);
});

test("windows executable and shortcut use cache-busting v3 icons", () => {
  const builder = read("apps/desktop/electron-builder.yml");
  const installer = read("apps/desktop/build/installer.nsh");

  assert.equal(builder.includes("icon: shanghao-icon-v3.ico"), true);
  assert.equal(builder.includes("signAndEditExecutable: false"), true);
  assert.equal(builder.includes("afterPack: ../../scripts/after-pack.cjs"), true);
  assert.equal(read("scripts/after-pack.cjs").includes("shanghao-icon-v3.ico"), true);
  assert.equal(installer.includes("shanghao-shortcut-v3.ico"), true);
});
