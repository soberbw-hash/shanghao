import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";

import { seatSlots } from "../src/renderer/src/features/voice-scene/sceneZones";
import { useRoomStore } from "../src/renderer/src/store/roomStore";
import { getNicknameValidationError } from "../src/renderer/src/utils/nickname";

const member = (latencyMs?: number): RoomMember => ({
  id: "peer-latency",
  nickname: "朋友",
  isHost: false,
  isLocal: false,
  isMuted: false,
  isDeafened: false,
  activity: "idle",
  sceneZone: "gameDesk2",
  latencyMs,
  presenceState: MemberPresenceState.Online,
  speakingState: MemberSpeakingState.Silent,
  joinState: MemberJoinState.Joined,
  volume: 1,
  joinedAt: "2026-07-13T00:00:00.000Z",
  connectionQuality: "good",
});

test("seat state updates preserve the last valid peer latency", () => {
  useRoomStore.getState().resetRoom();
  useRoomStore.getState().setMembers([member(32)]);
  useRoomStore.getState().setMembers([{ ...member(), sceneZone: "gameDesk3" }]);
  const updated = useRoomStore
    .getState()
    .room.members.find((candidate) => candidate.id === "peer-latency");
  assert.equal(updated?.latencyMs, 32);
  assert.equal(updated?.sceneZone, "gameDesk3");
});

test("ordinary workstation selection is idle until a real game is detected", () => {
  assert.equal(
    seatSlots.every((slot) => slot.activity === "idle"),
    true,
  );
});

test("local speaker and microphone state are applied atomically before server echoes", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useRoomState.ts"),
    "utf8",
  );
  assert.equal(source.includes("updateLocalPresence({ isMuted, isDeafened })"), true);
  assert.equal(source.includes("isMuted: audioState.isMuted"), true);
  assert.equal(source.includes("isDeafened: audioState.isDeafened"), true);
});

test("abusive, suggestive and family-title nickname variants are rejected", () => {
  for (const nickname of [
    "daddy",
    "d@d",
    "超级 D4ddy",
    "b-a-b-a",
    "粑粑",
    "拔拔",
    "爹地",
    "父亲",
    "爷爷",
    "叫我爸爸",
    "煞笔",
    "n.m.s.l",
    "约炮",
    "p0rn",
  ]) {
    assert.ok(getNicknameValidationError(nickname));
  }
  assert.equal(getNicknameValidationError("摸鱼小猫"), undefined);
  assert.equal(getNicknameValidationError("Sober"), undefined);
});

test("chat messages are uniformly left aligned with avatar and no per-message clock", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/components/chat/TemporaryChatPanel.tsx"),
    "utf8",
  );
  assert.equal(source.includes('message.isLocal ? "justify-end"'), false);
  assert.equal(source.includes("formatMessageTime"), false);
  assert.equal(source.includes("AvatarPlaceholder"), true);
  assert.equal(source.includes("chat-date-divider"), true);
  assert.equal(source.includes("animateSendFeedback"), true);
  assert.equal(source.includes('clearProps: "transform,opacity,visibility"'), true);
});

test("audio fallback only warns after sustained processor overload", () => {
  const bootstrapSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/hooks/useAppBootstrap.ts"),
    "utf8",
  );
  const workletSource = readFileSync(
    path.resolve(process.cwd(), "src/renderer/src/features/audio/rnnoiseProcessor.worklet.ts"),
    "utf8",
  );

  assert.equal(bootstrapSource.includes('reason !== "processor_overloaded"'), true);
  assert.equal(bootstrapSource.includes("hasReportedAudioOverload"), true);
  assert.equal(workletSource.includes("OVERLOAD_WARMUP_FRAMES = 300"), true);
  assert.equal(workletSource.includes("OVERLOAD_STRIKE_LIMIT = 2"), true);
});
