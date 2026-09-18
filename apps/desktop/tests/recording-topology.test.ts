import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecordingTopologyGuard,
  type RecordingTopologyInput,
} from "../src/renderer/src/features/recording/recordingTopology";

test("1000 speaking, latency and scene updates produce zero additional recording topology syncs", () => {
  const changed = createRecordingTopologyGuard();
  const member = { id: "peer", nickname: "Test", joinedAt: "now", isLocal: false };
  const state = {
    room: { roomId: "main", members: [member] },
    remoteStreams: {},
  } as RecordingTopologyInput;
  assert.equal(changed(state), true);
  let syncs = 0;
  for (let i = 0; i < 1000; i += 1) {
    const members = [
      {
        ...member,
        speakingState: i % 2 ? "speaking" : "silent",
        latencyMs: i,
        sceneZone: i % 2 ? "gameDesk1" : "gameDesk2",
      },
    ];
    if (changed({ ...state, room: { ...state.room, members } } as RecordingTopologyInput))
      syncs += 1;
  }
  assert.equal(syncs, 0);
});

test("join, leave, stream replacement, same-stream track replacement and enable changes synchronize", () => {
  const changed = createRecordingTopologyGuard();
  let track = { id: "audio", enabled: true, readyState: "live" };
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  const state = {
    room: { roomId: "main", members: [] },
    remoteStreams: { peer: stream },
  } as RecordingTopologyInput;
  assert.equal(changed(state), true);
  assert.equal(changed(state), false);
  track.enabled = false;
  assert.equal(changed(state), true);
  track = { ...track, id: "replacement" };
  assert.equal(changed(state), true);
  state.remoteStreams.peer = { getAudioTracks: () => [track] } as unknown as MediaStream;
  assert.equal(changed(state), true);
  state.room.members = [
    { id: "peer", nickname: "Test", joinedAt: "now" },
  ] as RecordingTopologyInput["room"]["members"];
  assert.equal(changed(state), true);
  state.room.members = [];
  assert.equal(changed(state), true);
  state.room.roomId = "side";
  assert.equal(changed(state), true);
  delete state.remoteStreams.peer;
  assert.equal(changed(state), true);
});
