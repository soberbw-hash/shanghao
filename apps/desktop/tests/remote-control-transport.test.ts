import assert from "node:assert/strict";
import test from "node:test";
import { RemoteControlTransport } from "../../../packages/webrtc/src/remoteControlTransport";
import { MeshPeerConnection } from "../../../packages/webrtc/src/createPeer";
import type { RemoteControlInputEnvelope } from "../../../packages/shared/src/types/remote-control.types";

class Channel extends EventTarget {
  readyState = "connecting";
  bufferedAmount = 0;
  ordered: boolean;
  maxRetransmits: number | null;
  maxPacketLifeTime = null;
  sent: string[] = [];
  constructor(
    public label: string,
    options: RTCDataChannelInit = {},
  ) {
    super();
    this.ordered = options.ordered ?? true;
    this.maxRetransmits = options.maxRetransmits ?? null;
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
  send(value: string) {
    this.sent.push(value);
  }
  message(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: value }));
  }
  close() {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }
}
class Connection extends EventTarget {
  connectionState = "connected";
  channels: Channel[] = [];
  createDataChannel(label: string, options: RTCDataChannelInit) {
    const channel = new Channel(label, options);
    this.channels.push(channel);
    return channel;
  }
}
const identity = (peerId: string) => ({
  peerId,
  memberSessionId: "member-1",
  memberGeneration: 1,
  deviceId: "device-1",
});
const input = (kind = "pointer"): RemoteControlInputEnvelope => ({
  grantId: "grant-1",
  generation: 1,
  sequence: 1,
  hostTimeMs: 100,
  binding: {
    roomId: "room-1",
    shareSessionId: "share-1",
    captureHandle: "capture-1",
    displayId: "display-1",
    geometryVersion: 1,
    target: identity("target"),
    controller: identity("claimed-payload-sender"),
  },
  event:
    kind === "pointer"
      ? { kind: "pointer", x: 0.4, y: 0.5 }
      : { kind: "key", code: "KeyA", pressed: true },
});
const fixture = () => {
  const connection = new Connection();
  let now = 100;
  const received: Array<{ peerId: string; lane: string; message: unknown }> = [];
  const transport = new RemoteControlTransport(
    connection as never,
    "authenticated-peer",
    {
      onMessage: (peerId, message, lane) => received.push({ peerId, message, lane }),
    },
    () => now,
  );
  transport.createChannels();
  const control = connection.channels[0]!,
    pointer = connection.channels[1]!;
  const ready = () => {
    control.open();
    pointer.open();
    control.message('{"v":1,"type":"hello"}');
    control.message('{"v":1,"type":"hello-ack"}');
  };
  return {
    connection,
    transport,
    received,
    control,
    pointer,
    ready,
    advance: () => {
      now += 1000;
    },
  };
};

test("remote control negotiates only fixed reliable and lossy lanes and requires a version handshake", () => {
  const f = fixture();
  assert.equal(f.control.label, "shanghao.remote-control.v1");
  assert.equal(f.pointer.label, "shanghao.remote-pointer.v1");
  assert.equal(f.control.ordered, true);
  assert.equal(f.control.maxRetransmits, null);
  assert.equal(f.pointer.ordered, false);
  assert.equal(f.pointer.maxRetransmits, 0);
  f.control.open();
  f.pointer.open();
  assert.equal(f.transport.capability().available, false);
  assert.equal(f.transport.sendPointer(input()).ok, false);
  f.ready();
  assert.equal(f.transport.capability().available, true);
  f.transport.destroy();
});

test("authenticated Peer identity accompanies input instead of trusting claimed payload identity", () => {
  const f = fixture();
  f.ready();
  f.pointer.message(JSON.stringify({ v: 1, type: "input", input: input() }));
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0]?.peerId, "authenticated-peer");
  assert.equal(f.received[0]?.lane, "pointer");
  f.control.message(JSON.stringify({ v: 1, type: "input", input: input("key") }));
  assert.equal(f.received[1]?.lane, "reliable");
  f.transport.destroy();
});

test("lane confusion, forged fields, binary and oversized messages never reach the host", () => {
  const f = fixture();
  f.ready();
  f.pointer.message(JSON.stringify({ v: 1, type: "input", input: input("key") }));
  f.control.message(JSON.stringify({ v: 1, type: "input", input: input() }));
  f.pointer.message(JSON.stringify({ v: 1, type: "input", input: input(), sender: "target" }));
  f.pointer.message(new Uint8Array(12));
  f.control.message("x".repeat(4097));
  const forged = input();
  forged.event = { kind: "pointer", x: 10, y: 0 };
  f.pointer.message(JSON.stringify({ v: 1, type: "input", input: forged }));
  assert.equal(f.received.length, 0);
  f.transport.destroy();
});

test("sends and receives are rate bounded, backpressure never queues stale pointer input", () => {
  const f = fixture();
  f.ready();
  f.pointer.bufferedAmount = 65_536;
  assert.equal(f.transport.sendPointer(input()).ok, false);
  assert.equal(f.pointer.sent.length, 0);
  f.pointer.bufferedAmount = 0;
  let sent = 0;
  for (let i = 0; i < 1000; i++) if (f.transport.sendPointer(input()).ok) sent++;
  assert.ok(sent > 0 && sent <= 120);
  for (let i = 0; i < 1000; i++)
    f.pointer.message(JSON.stringify({ v: 1, type: "input", input: input() }));
  assert.ok(f.received.length <= 120);
  f.advance();
  assert.equal(f.transport.sendPointer(input()).ok, true);
  f.transport.destroy();
});

test("disconnect and destruction make control unavailable and detach channel listeners", () => {
  const f = fixture();
  f.ready();
  f.connection.connectionState = "disconnected";
  f.connection.dispatchEvent(new Event("connectionstatechange"));
  assert.equal(f.transport.capability().available, false);
  assert.equal(f.transport.sendReliable({ v: 1, type: "input", input: input("key") }).ok, false);
  f.transport.destroy();
  f.pointer.message(JSON.stringify({ v: 1, type: "input", input: input() }));
  assert.equal(f.received.length, 0);
  assert.equal(f.control.readyState, "closed");
  assert.equal(f.pointer.readyState, "closed");
});

test("request, grant, denial and revoke use only the reliable authenticated callback", () => {
  const f = fixture();
  f.ready();
  const binding = input().binding;
  const messages = [
    {
      v: 1,
      type: "request",
      request: { requestId: "request-1", binding, requestedAtMs: 100, expiresAtMs: 500 },
    },
    {
      v: 1,
      type: "grant",
      grant: {
        grantId: "grant-1",
        generation: 1,
        binding,
        permissions: ["pointer", "keyboard", "text"],
        issuedAtMs: 100,
        expiresAtMs: null,
      },
    },
    { v: 1, type: "deny", requestId: "request-1", reason: "denied" },
    { v: 1, type: "revoke", grantId: "grant-1", generation: 1, reason: "stopped" },
  ];
  for (const message of messages) {
    f.pointer.message(JSON.stringify(message));
    f.control.message(JSON.stringify(message));
  }
  assert.equal(f.received.length, 4);
  assert.ok(
    f.received.every((event) => event.lane === "reliable" && event.peerId === "authenticated-peer"),
  );
  f.transport.destroy();
});

test("answerer adopts one valid channel per fixed label and rejects a retransmitting pointer", () => {
  const connection = new Connection();
  const transport = new RemoteControlTransport(connection as never, "peer", {
    onMessage: () => {},
  });
  const deliver = (channel: Channel) =>
    connection.dispatchEvent(Object.assign(new Event("datachannel"), { channel }));
  const reliable = new Channel("shanghao.remote-control.v1", { ordered: true });
  deliver(reliable);
  const wrong = new Channel("shanghao.remote-pointer.v1", { ordered: false, maxRetransmits: 1 });
  deliver(wrong);
  assert.equal(wrong.readyState, "closed");
  const pointer = new Channel("shanghao.remote-pointer.v1", { ordered: false, maxRetransmits: 0 });
  deliver(pointer);
  const duplicate = new Channel("shanghao.remote-control.v1", { ordered: true });
  deliver(duplicate);
  assert.equal(duplicate.readyState, "closed");
  reliable.open();
  pointer.open();
  reliable.message('{"v":1,"type":"hello"}');
  reliable.message('{"v":1,"type":"hello-ack"}');
  assert.equal(transport.capability().available, true);
  transport.destroy();
});

test("reliable backpressure fails the control transport so a key-up cannot be silently dropped", () => {
  const f = fixture();
  f.ready();
  f.control.bufferedAmount = 65_536;
  const result = f.transport.sendReliable({ v: 1, type: "input", input: input("key") });
  assert.deepEqual(result, { ok: false, reason: "control-backpressure" });
  assert.deepEqual(f.transport.capability(), { available: false, reason: "control-backpressure" });
  assert.equal(f.control.readyState, "closed");
  f.transport.destroy();
});

test("Mesh keeps one peer connection and unchanged media setup when remote control is optional", async () => {
  const oldConnection = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  const oldStream = Object.getOwnPropertyDescriptor(globalThis, "MediaStream");
  const connections: Peer[] = [];
  class Stream {
    getTracks() {
      return [];
    }
  }
  class Peer extends Connection {
    signalingState = "stable";
    localDescription: unknown;
    transceivers = 0;
    closed = false;
    constructor() {
      super();
      connections.push(this);
    }
    addTransceiver() {
      this.transceivers++;
      return {
        sender: {
          track: null,
          replaceTrack: async () => {},
          getParameters: () => ({}),
          setParameters: async () => {},
        },
      };
    }
    getSenders() {
      return [];
    }
    async createOffer() {
      return { type: "offer", sdp: "v=0\r\n" };
    }
    async setLocalDescription(description: unknown) {
      this.localDescription = description;
    }
    close() {
      this.closed = true;
    }
  }
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: Peer });
  Object.defineProperty(globalThis, "MediaStream", { configurable: true, value: Stream });
  const peers: MeshPeerConnection[] = [];
  try {
    const options = {
      peerId: "remote-authenticated",
      localStream: new Stream() as never,
      onIceCandidate: () => {},
      onRemoteStream: () => {},
    };
    const legacy = new MeshPeerConnection(options);
    peers.push(legacy);
    await legacy.createOffer();
    assert.equal(connections[0]!.channels.length, 0);
    assert.equal(legacy.getRemoteControlCapability().available, false);
    const modern = new MeshPeerConnection({ ...options, remoteControl: { onMessage: () => {} } });
    peers.push(modern);
    await modern.createOffer();
    await modern.createOffer();
    assert.equal(connections.length, 2, "exactly one connection per Mesh peer");
    assert.equal(connections[1]!.channels.length, 2, "renegotiation reuses both channels");
    assert.equal(connections[0]!.transceivers, connections[1]!.transceivers);
    assert.equal(
      modern.sendRemotePointer(input()).ok,
      false,
      "no data-channel handshake means unavailable",
    );
    modern.destroy();
    assert.ok(connections[1]!.channels.every((channel) => channel.readyState === "closed"));
  } finally {
    for (const peer of peers) peer.destroy();
    if (oldConnection) Object.defineProperty(globalThis, "RTCPeerConnection", oldConnection);
    else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
    if (oldStream) Object.defineProperty(globalThis, "MediaStream", oldStream);
    else Reflect.deleteProperty(globalThis, "MediaStream");
  }
});
