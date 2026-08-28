import assert from "node:assert/strict";
import test from "node:test";

import { MemberPresenceState, MemberSpeakingState, type RoomMember } from "@private-voice/shared";

import { RoomMemberEventCoordinator } from "../src/renderer/src/features/room/RoomMemberEventCoordinator";
import {
  decodeQuickMessageControlTarget,
  encodeQuickMessageControlTarget,
} from "../src/renderer/src/features/chat/quickReplies";
import { isSignalEnvelope } from "@private-voice/signaling";

const createMember = (
  id: string,
  isLocal: boolean,
  sceneZone: RoomMember["sceneZone"],
): RoomMember => ({
  id,
  nickname: id,
  isHost: isLocal,
  isLocal,
  isMuted: false,
  activity: "idle",
  sceneZone,
  presenceState: MemberPresenceState.Online,
  speakingState: MemberSpeakingState.Silent,
  volume: 1,
  joinedAt: "2026-08-15T00:00:00.000Z",
  connectionQuality: "excellent",
});

test("remote member events cannot replay the local member's previous seat", () => {
  const snapshots: RoomMember[][] = [];
  const coordinator = new RoomMemberEventCoordinator({
    localPeerId: "local",
    onMembers: (members) => snapshots.push(members),
    onCollection: () => undefined,
    onKnock: () => undefined,
    onReaction: () => undefined,
    onQuickMessage: () => undefined,
  });

  coordinator.setMembers([
    createMember("local", true, "gameDesk1"),
    createMember("remote", false, "gameDesk2"),
  ]);
  coordinator.updateLocalPresence(false, "idle", "gameDesk3");

  coordinator.handleMemberState({
    type: "member_state",
    roomId: "main",
    peerId: "remote",
    isSpeaking: true,
  });

  assert.equal(snapshots.at(-1)?.find((member) => member.isLocal)?.sceneZone, "gameDesk3");
});

test("the server can still authoritatively resolve a local seat conflict", () => {
  const snapshots: RoomMember[][] = [];
  const coordinator = new RoomMemberEventCoordinator({
    localPeerId: "local",
    onMembers: (members) => snapshots.push(members),
    onCollection: () => undefined,
    onKnock: () => undefined,
    onReaction: () => undefined,
    onQuickMessage: () => undefined,
  });

  coordinator.setMembers([createMember("local", true, "gameDesk1")]);
  coordinator.updateLocalPresence(false, "idle", "gameDesk3");
  coordinator.handleMemberState({
    type: "member_state",
    roomId: "main",
    peerId: "local",
    sceneZone: "gameDesk4",
  });

  assert.equal(snapshots.at(-1)?.find((member) => member.isLocal)?.sceneZone, "gameDesk4");
});

test("music toggle controls ignore local echoes and reach remote listeners", () => {
  const controls: Array<{ presetId: string; peerId: string }> = [];
  const coordinator = new RoomMemberEventCoordinator({
    localPeerId: "local",
    onMembers: () => undefined,
    onCollection: () => undefined,
    onKnock: () => undefined,
    onReaction: () => undefined,
    onQuickMessage: () => undefined,
    onQuickMessageControl: ({ presetId, peerId }) => controls.push({ presetId, peerId }),
  });
  const musicPresetId = "music-delta-出泪小曲";
  const targetPeerId = encodeQuickMessageControlTarget(musicPresetId);
  assert.match(targetPeerId, /^[A-Za-z0-9._:-]+$/);
  assert.deepEqual(decodeQuickMessageControlTarget(targetPeerId), {
    presetId: musicPresetId,
    control: "toggle",
  });
  assert.equal(
    isSignalEnvelope({
      type: "scene_reaction",
      roomId: "main",
      peerId: "local",
      targetPeerId,
      emoji: "👍",
      createdAt: "2026-08-27T00:00:00.000Z",
    }),
    true,
  );

  coordinator.handleReaction({
    type: "scene_reaction",
    roomId: "main",
    peerId: "local",
    targetPeerId,
    emoji: "👍",
    createdAt: "2026-08-27T00:00:00.000Z",
  });
  coordinator.handleReaction({
    type: "scene_reaction",
    roomId: "main",
    peerId: "remote",
    targetPeerId,
    emoji: "👍",
    createdAt: "2026-08-27T00:00:01.000Z",
  });

  assert.deepEqual(controls, [{ presetId: musicPresetId, peerId: "remote" }]);
});
