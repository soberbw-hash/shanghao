import assert from "node:assert/strict";
import test from "node:test";

import type { MeshPeerConnection } from "@private-voice/webrtc";

test("screen share stop restores the microphone when one peer rejects track removal", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const sentStates: boolean[] = [];
  let stoppedTracks = 0;
  let restoredInputs = 0;
  let detachedPeers = 0;
  let nextTimer = 0;
  const timers = new Set<number>();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktopApi: { app: { writeLog: async () => undefined } },
      setInterval: () => {
        timers.add(++nextTimer);
        return nextTimer;
      },
      clearInterval: (timer: number) => timers.delete(timer),
    },
  });
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const { RoomScreenShareCoordinator } =
    await import("../src/renderer/src/features/screen-share/RoomScreenShareCoordinator");
  const videoTrack = {
    id: "capture-one",
    readyState: "live",
    addEventListener: () => undefined,
    getSettings: () => ({ width: 1_920, height: 1_080, frameRate: 30 }),
    stop: () => {
      stoppedTracks += 1;
    },
  } as unknown as MediaStreamTrack;
  const stream = {
    getVideoTracks: () => [videoTrack],
    getAudioTracks: () => [],
    getTracks: () => [videoTrack],
  } as unknown as MediaStream;
  const makePeer = (rejectDetach: boolean) =>
    ({
      setScreenTrack: async (track?: MediaStreamTrack) => {
        if (track) return;
        detachedPeers += 1;
        if (rejectDetach) throw new Error("peer_disconnected");
      },
      getScreenShareSenderStats: async () => undefined,
    }) as unknown as MeshPeerConnection;
  const peers = new Map([
    ["peer-a", makePeer(true)],
    ["peer-b", makePeer(false)],
  ]);
  const coordinator = new RoomScreenShareCoordinator({
    roomId: "room-a",
    peerId: "local",
    getPeers: () => peers,
    getRemotePeerIds: () => new Set(peers.keys()),
    getWebRtcScreenPeerIds: () => new Set<string>(),
    getPrimaryInputTrack: () => undefined,
    applyScreenAudioMix: async () => undefined,
    restorePrimaryInputTrack: async () => {
      restoredInputs += 1;
    },
    safeSend: async (payload) => {
      if (payload.type === "screen_share_state") sentStates.push(payload.isSharing);
      return true;
    },
    onRemoteFrame: () => undefined,
    onRemoteState: () => undefined,
    onScreenTrackLost: () => undefined,
    onLocalViewerIdsChange: () => undefined,
  });

  await coordinator.start(stream);
  await coordinator.stop();
  assert.equal(detachedPeers, 2);
  assert.equal(restoredInputs, 1);
  assert.equal(stoppedTracks, 1);
  assert.equal(coordinator.activeStream, undefined);
  assert.deepEqual(sentStates, [true, false]);
  assert.equal(timers.size, 0);
});
