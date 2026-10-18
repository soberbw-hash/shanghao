import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { MeshPeerConnection } from "@private-voice/webrtc";

const fixture = async (t: TestContext) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: { app: { writeLog: async () => {} } },
      setInterval: () => 1,
      clearInterval: () => {},
    },
  });
  t.after(() =>
    original
      ? Object.defineProperty(globalThis, "window", original)
      : Reflect.deleteProperty(globalThis, "window"),
  );
  const { RoomScreenShareCoordinator } =
    await import("../src/renderer/src/features/screen-share/RoomScreenShareCoordinator");
  const states: boolean[] = [],
    recovered: string[] = [];
  let restore = async () => {};
  const peers = new Map<string, MeshPeerConnection>();
  const coordinator = new RoomScreenShareCoordinator({
    roomId: "main",
    peerId: "local",
    getPeers: () => peers,
    getRemotePeerIds: () => new Set(peers.keys()),
    getWebRtcScreenPeerIds: () => new Set(),
    getPrimaryInputTrack: () => undefined,
    applyScreenAudioMix: async () => {},
    restorePrimaryInputTrack: () => restore(),
    safeSend: async (message) => {
      if (message.type === "screen_share_state") states.push(message.isSharing);
      return true;
    },
    onRemoteFrame: () => {},
    onRemoteState: () => {},
    onScreenTrackLost: (id) => recovered.push(id),
    onLocalViewerIdsChange: () => {},
  });
  const stream = (id: string) => {
    let ended = () => {};
    const track = {
      id,
      readyState: "live",
      addEventListener: (_name: string, callback: () => void) => {
        ended = callback;
      },
      getSettings: () => ({}),
      stop: () => {
        track.readyState = "ended";
      },
    };
    return {
      stream: {
        getVideoTracks: () => [track],
        getAudioTracks: () => [],
        getTracks: () => [track],
      } as unknown as MediaStream,
      ended: () => ended(),
    };
  };
  t.after(() => coordinator.clear());
  return {
    coordinator,
    states,
    recovered,
    peers,
    stream,
    setRestore: (next: typeof restore) => {
      restore = next;
    },
  };
};

test("an old capture ended callback queued behind a replacement cannot stop the new share", async (t) => {
  const f = await fixture(t),
    first = f.stream("old"),
    second = f.stream("new");
  await f.coordinator.start(first.stream);
  let finish!: () => void;
  f.setRestore(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const replacing = f.coordinator.start(second.stream);
  await new Promise<void>((resolve) => setImmediate(resolve));
  first.ended();
  finish();
  await replacing;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.coordinator.activeStream, second.stream);
  assert.deepEqual(f.states, [true, true]);
  f.setRestore(async () => {});
  await f.coordinator.stop();
  assert.equal(second.stream.getVideoTracks()[0]?.readyState, "ended");
});

test("a failed screen sender recovers only that peer and retains the working capture", async (t) => {
  const f = await fixture(t),
    capture = f.stream("capture");
  let healthyAttached = false;
  f.peers.set("broken", {
    setScreenTrack: async () => {
      throw Error("closed peer");
    },
    getScreenShareSenderStats: async () => undefined,
  } as unknown as MeshPeerConnection);
  f.peers.set("healthy", {
    setScreenTrack: async (track: unknown) => {
      healthyAttached = Boolean(track);
    },
    getScreenShareSenderStats: async () => undefined,
  } as unknown as MeshPeerConnection);
  await f.coordinator.start(capture.stream);
  assert.equal(healthyAttached, true);
  assert.equal(f.coordinator.activeStream, capture.stream);
  assert.deepEqual(f.recovered, ["broken"]);
  await f.coordinator.stop();
  assert.equal(healthyAttached, false);
});

test("room teardown invalidates a queued screen start before it can resurrect capture", async (t) => {
  const f = await fixture(t),
    capture = f.stream("late-capture");
  const starting = f.coordinator.start(capture.stream);
  f.coordinator.clear();
  await assert.rejects(starting, /screen_share_superseded/);
  assert.equal(f.coordinator.activeStream, undefined);
  assert.deepEqual(f.states, []);
});
