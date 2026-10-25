import assert from "node:assert/strict";
import test from "node:test";

test("stats polls never overlap and departed or replaced peer results cannot overwrite current health", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopApi: { app: { writeLog: async () => {} } } },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const { PeerStatsMonitor } = await import("../src/renderer/src/features/room/PeerStatsMonitor");
  let release!: (value: Map<string, unknown>) => void,
    requests = 0;
  const old = {
    connection: {
      getStats: () => {
        requests++;
        return new Promise<Map<string, unknown>>((resolve) => (release = resolve));
      },
    },
    adaptToNetwork: async () => "healthy",
  };
  const report = (rtt: number) =>
    new Map([
      [
        "audio",
        {
          id: "audio",
          type: "inbound-rtp",
          kind: "audio",
          bytesReceived: 1000,
          packetsReceived: 10,
        },
      ],
      [
        "pair",
        {
          id: "pair",
          type: "candidate-pair",
          state: "succeeded",
          selected: true,
          currentRoundTripTime: rtt,
        },
      ],
    ]);
  const current = {
    connection: { getStats: async () => report(0.03) },
    adaptToNetwork: async () => "healthy",
  };
  const peers = new Map<string, unknown>([["peer", old]]),
    latency: number[] = [];
  const monitor = new PeerStatsMonitor({
    getPeers: () => peers,
    getPeerState: () => ({
      isRemotePeer: true,
      isConnected: true,
      hasRemoteAudio: true,
      isRemoteMuted: false,
      isRemoteSpeaking: true,
      iceState: "connected",
    }),
    getRecovery: () => ({ count: 0 }),
    getResources: () => ({}),
    onFlowEvaluation: () => {},
    onLatency: (_peer: string, value: number) => latency.push(value),
  } as never);
  const collect = () => (monitor as unknown as { collect(): Promise<void> }).collect();
  const pending = collect();
  await collect();
  assert.equal(requests, 1);
  monitor.stop();
  peers.set("peer", current);
  await collect();
  release(report(1.2));
  await pending;
  assert.deepEqual(latency, [30]);
  assert.equal(monitor.getStats().peer?.roundTripTimeMs, 30);
  monitor.stop();
});

test("quality repair has a cooldown even when normal RTP temporarily clears recovery attempts", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let timers = 0,
    now = 100000;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: { app: { writeLog: async () => {} } },
      setTimeout: () => ++timers,
      clearTimeout: () => {},
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  t.mock.method(Date, "now", () => now);
  const { PeerRecoveryCoordinator } =
    await import("../src/renderer/src/features/room/PeerRecoveryCoordinator");
  const recovery = new PeerRecoveryCoordinator({
    canRecover: () => true,
    remotePeerIds: new Set(["peer"]),
  } as never);
  recovery.schedule("peer", "inbound_playout_degraded");
  recovery.clear("peer", true);
  recovery.schedule("peer", "inbound_playout_degraded");
  assert.equal(timers, 1);
  now += 30000;
  recovery.schedule("peer", "inbound_playout_degraded");
  assert.equal(timers, 2);
  recovery.clearAll();
});

test("friends losing our outgoing voice is detected even when their incoming voice is healthy", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { desktopApi: { app: { writeLog: async () => {} } } },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const { PeerStatsMonitor } = await import("../src/renderer/src/features/room/PeerStatsMonitor");
  let count = 0,
    loss = 0.5,
    speaking = true;
  const reasons: Array<string | undefined> = [];
  const peer = {
    connection: {
      getStats: async () => {
        count++;
        return new Map([
          [
            "incoming",
            {
              id: "incoming",
              type: "inbound-rtp",
              kind: "audio",
              packetsReceived: count * 50,
              bytesReceived: count * 2000,
              totalSamplesReceived: count * 48000,
              concealedSamples: 0,
              packetsLost: 0,
            },
          ],
          [
            "outgoing",
            { id: "outgoing", type: "outbound-rtp", kind: "audio", packetsSent: count * 50 },
          ],
          [
            "remote",
            {
              id: "remote",
              type: "remote-inbound-rtp",
              kind: "audio",
              localId: "outgoing",
              fractionLost: loss,
            },
          ],
        ]);
      },
    },
    adaptToNetwork: async () => "healthy",
  };
  const monitor = new PeerStatsMonitor({
    getPeers: () => [["peer", peer]],
    getPeerState: () => ({
      isRemotePeer: true,
      isConnected: true,
      hasRemoteAudio: true,
      isRemoteMuted: false,
      isRemoteSpeaking: false,
      isLocalSpeaking: speaking,
      iceState: "connected",
    }),
    getRecovery: () => ({ count: 0 }),
    getResources: () => ({}),
    onFlowEvaluation: (_id: string, _stats: unknown, flow: { reason?: string }) =>
      reasons.push(flow.reason),
  } as never);
  const collect = () => (monitor as unknown as { collect(): Promise<void> }).collect();
  for (let i = 0; i < 5; i++) await collect();
  assert.equal(reasons.at(-1), "outbound_degraded");
  assert.equal(
    monitor.getStats().peer?.inboundAudioFlow,
    "flowing",
    "outgoing damage must not pretend incoming RTP stopped",
  );
  loss = 0;
  for (let i = 0; i < 3; i++) await collect();
  assert.equal(reasons.at(-1), undefined);
  loss = 1;
  speaking = false;
  for (let i = 0; i < 6; i++) await collect();
  assert.equal(reasons.at(-1), undefined, "mute and idle users must not force peer rebuilds");
  monitor.stop();
});

test("outgoing voice recovery rebuilds only the damaged peer even when inbound RTP is already ready", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let fire!: () => void;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: { app: { writeLog: async () => {} } },
      setTimeout: (callback: () => void) => {
        fire = callback;
        return 1;
      },
      clearTimeout: () => {},
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const { PeerRecoveryCoordinator } =
    await import("../src/renderer/src/features/room/PeerRecoveryCoordinator");
  const { PeerOperationQueue } =
    await import("../src/renderer/src/features/room/PeerOperationQueue");
  const old = {},
    other = {},
    fresh = { createOffer: async () => ({ type: "offer", sdp: "synthetic" }) };
  const peers = new Map<string, unknown>([
      ["b", old],
      ["c", other],
    ]),
    replaced: string[] = [],
    sent: Array<{ targetPeerId: string }> = [];
  const recovery = new PeerRecoveryCoordinator({
    localPeerId: "a",
    roomId: "room",
    peers,
    remotePeerIds: new Set(["b", "c"]),
    connectedPeerIds: new Set(["b", "c"]),
    readyPeerIds: new Set(["b", "c"]),
    operationQueue: new PeerOperationQueue(),
    canRecover: () => true,
    replacePeer: (id: string) => {
      replaced.push(id);
      peers.set(id, fresh);
      return fresh;
    },
    applyScreenShare: async () => {},
    notifyScreenShare: () => {},
    send: async (packet: { targetPeerId: string }) => {
      sent.push(packet);
    },
  } as never);
  assert.equal(recovery.schedule("b", "outbound_playout_degraded"), true);
  fire();
  for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(replaced, ["b"]);
  assert.equal(peers.get("c"), other);
  assert.equal(sent[0]?.targetPeerId, "b");
  recovery.clearAll();
});
