import assert from "node:assert/strict";
import test from "node:test";
import {
  MemberSpeakingState,
  PushToTalkState,
  RoomConnectionState,
  type RoomMember,
} from "@private-voice/shared";
import { backgroundAudioActivity } from "../src/renderer/src/features/audio/backgroundAudioActivity";

const local = {
  id: "local",
  isLocal: true,
  speakingState: MemberSpeakingState.Speaking,
} as RoomMember;
const peer = {
  id: "peer",
  isLocal: false,
  speakingState: MemberSpeakingState.Speaking,
  volume: 1,
} as RoomMember;
const audio = {
  isMuted: false,
  isDeafened: false,
  phoneModeActive: false,
  listenOnly: false,
  isPushToTalkEnabled: false,
  pushToTalkState: PushToTalkState.Off,
};
const room = (members = [local]) => ({ connectionState: RoomConnectionState.Connected, members });
test("background activity uses audible room speech and ignores muted, zero-volume and empty peers", () => {
  assert.equal(backgroundAudioActivity(room(), audio).speaking, true);
  for (const changed of [
    { isMuted: true },
    { isDeafened: true },
    { listenOnly: true },
    { phoneModeActive: true },
    { isPushToTalkEnabled: true, pushToTalkState: PushToTalkState.Armed },
  ])
    assert.equal(backgroundAudioActivity(room(), { ...audio, ...changed }).speaking, false);
  assert.equal(
    backgroundAudioActivity(room([local, peer]), { ...audio, isMuted: true }).speaking,
    true,
  );
  for (const changed of [{ isMuted: true }, { volume: 0 }, { isEmptySlot: true }])
    assert.equal(
      backgroundAudioActivity(room([local, { ...peer, ...changed }]), { ...audio, isMuted: true })
        .speaking,
      false,
    );
  assert.equal(
    backgroundAudioActivity({ ...room(), connectionState: RoomConnectionState.Reconnecting }, audio)
      .inRoom,
    false,
  );
});
