import assert from "node:assert/strict";
import test from "node:test";
import {
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
  type RoomMember,
} from "@private-voice/shared";
import {
  RoomSoundFeedback,
  type RoomSoundSnapshot,
} from "../src/renderer/src/features/audio/roomSoundFeedback";
import type { UiSound } from "../src/renderer/src/features/audio/uiSound";

const member = (id: string, patch: Partial<RoomMember> = {}): RoomMember => ({
  id,
  nickname: id,
  isLocal: false,
  isHost: false,
  isMuted: false,
  volume: 1,
  joinedAt: "2026-10-01",
  connectionQuality: "good",
  presenceState: MemberPresenceState.Online,
  speakingState: MemberSpeakingState.Silent,
  ...patch,
});
const fixture = () => {
  let snapshot: RoomSoundSnapshot = {
    room: {
      roomId: "room-a",
      signalingUrl: "wss://example.test",
      lifecycleState: RoomLifecycleState.Open,
      connectionState: RoomConnectionState.WaitingPeer,
      members: [member("me", { isLocal: true })],
    },
    isMuted: false,
    isDeafened: false,
    reconnectAttempt: 0,
    remoteScreenSharing: {},
  };
  const sounds: UiSound[] = [];
  const feedback = new RoomSoundFeedback(
    () => snapshot,
    (sound) => sounds.push(sound),
  );
  const update = (
    patch: Partial<RoomSoundSnapshot> = {},
    roomPatch: Partial<RoomSoundSnapshot["room"]> = {},
  ) => {
    snapshot = { ...snapshot, ...patch, room: { ...snapshot.room, ...roomPatch } };
    feedback.update();
  };
  return { feedback, sounds, update, read: () => snapshot };
};

test("initial snapshot is quiet; joins and departures produce one cue per update", () => {
  const f = fixture();
  const alice = member("alice");
  f.update({}, { members: [alice] });
  assert.deepEqual(f.sounds, []);
  f.update({}, { members: [alice, member("bob"), member("cat")] });
  f.update();
  f.update({}, { members: [alice] });
  assert.deepEqual(f.sounds, ["member-join", "member-leave"]);
  f.feedback.dispose();
});

test("stable account identities survive peer replacement; offline placeholders leave once", () => {
  const f = fixture();
  f.update({}, { members: [member("old", { userId: "alice" })] });
  f.update(
    {},
    {
      members: [
        member("new", { userId: "alice", presenceState: MemberPresenceState.Reconnecting }),
      ],
    },
  );
  f.update(
    {},
    { members: [member("new", { userId: "alice" }), member("empty", { isEmptySlot: true })] },
  );
  assert.deepEqual(f.sounds, []);
  f.update(
    {},
    { members: [member("new", { userId: "alice", presenceState: MemberPresenceState.Offline })] },
  );
  f.update({}, { members: [] });
  assert.deepEqual(f.sounds, ["member-leave"]);
});

test("room and server switches rebase members instead of announcing the old room leaving", () => {
  const f = fixture();
  f.update({}, { members: [member("alice")] });
  f.update({}, { roomId: "room-b", members: [member("bob")] });
  f.update({}, { signalingUrl: "wss://other.test", members: [member("cat")] });
  f.update({}, { lifecycleState: RoomLifecycleState.Closing, members: [] });
  f.update({}, { lifecycleState: RoomLifecycleState.Closed });
  assert.deepEqual(f.sounds, []);
});

test("local away and return replace automatic mute cues, including an already muted user", () => {
  const f = fixture();
  f.update();
  f.update(
    { isMuted: true },
    { members: [member("me", { isLocal: true, sceneZone: "restroomZone" })] },
  );
  f.update(
    { isMuted: false },
    { members: [member("me", { isLocal: true, sceneZone: "gameDesk1" })] },
  );
  f.update({ isMuted: true });
  f.update({}, { members: [member("me", { isLocal: true, sceneZone: "restroomZone" })] });
  f.update({ isDeafened: true });
  assert.deepEqual(f.sounds, ["away", "return", "mic-off", "away", "speaker-muted"]);
});

test("remote away is distinct from leaving, and speaking/activity updates stay quiet", () => {
  const f = fixture();
  f.update({}, { members: [member("alice")] });
  f.update(
    {},
    {
      members: [
        member("alice", { speakingState: MemberSpeakingState.Speaking, activity: "gaming" }),
      ],
    },
  );
  f.update({}, { members: [member("alice", { sceneZone: "restroomZone" })] });
  f.update();
  f.update({}, { members: [member("alice", { sceneZone: "gameDesk2" })] });
  f.update({}, { members: [] });
  assert.deepEqual(f.sounds, ["member-away", "member-return", "member-leave"]);
});

test("remote share feedback follows start/stop and ignores the initial snapshot and owner departure", () => {
  const f = fixture();
  f.update({ remoteScreenSharing: { alice: true } }, { members: [member("alice")] });
  f.update({ remoteScreenSharing: {} });
  f.update({ remoteScreenSharing: { alice: true } });
  f.update({ remoteScreenSharing: {} }, { members: [] });
  assert.deepEqual(f.sounds, ["screen-share-stop", "screen-share-start", "member-leave"]);
});

test("recovery waits for stability, rebaselines members and cancels on leave, switch or disposal", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  f.update({}, { members: [member("alice")] });
  f.update({ reconnectAttempt: 1 }, { connectionState: RoomConnectionState.Reconnecting });
  f.update(
    { reconnectAttempt: 0 },
    { connectionState: RoomConnectionState.Connected, members: [member("bob")] },
  );
  t.mock.timers.tick(2999);
  assert.deepEqual(f.sounds, []);
  t.mock.timers.tick(1);
  assert.deepEqual(f.sounds, ["connection-restored"]);
  f.update();
  for (const action of ["leave", "switch", "dispose"] as const) {
    f.update({ reconnectAttempt: 1 }, { connectionState: RoomConnectionState.Reconnecting });
    f.update({ reconnectAttempt: 0 }, { connectionState: RoomConnectionState.Connected });
    if (action === "leave") f.update({}, { lifecycleState: RoomLifecycleState.Closing });
    if (action === "switch") f.update({}, { roomId: "room-new" });
    if (action === "dispose") f.feedback.dispose();
    t.mock.timers.tick(3000);
    assert.deepEqual(f.sounds, ["connection-restored"]);
    f.update({}, { lifecycleState: RoomLifecycleState.Open });
  }
  f.feedback.dispose();
});

test("persistent failure sounds once; an explicit new join can fail with its own cue", () => {
  const f = fixture();
  f.update();
  f.update(
    { reconnectAttempt: 2 },
    { connectionState: RoomConnectionState.Failed, lifecycleState: RoomLifecycleState.Failed },
  );
  f.update();
  f.update({}, { members: [member("alice")] });
  assert.deepEqual(f.sounds, ["connection-failed"]);
  f.update(
    { reconnectAttempt: 0 },
    { lifecycleState: RoomLifecycleState.Opening, connectionState: RoomConnectionState.Joining },
  );
  f.update(
    {},
    { lifecycleState: RoomLifecycleState.Failed, connectionState: RoomConnectionState.Failed },
  );
  assert.deepEqual(f.sounds, ["connection-failed", "connection-failed"]);
});

test("speaker toggles own their coupled microphone transition instead of stacking two cues", () => {
  const f = fixture();
  f.update();
  f.update({ isMuted: true, isDeafened: true });
  f.update({ isMuted: false, isDeafened: false });
  assert.deepEqual(f.sounds, ["speaker-muted", "speaker-unmuted"]);
});
