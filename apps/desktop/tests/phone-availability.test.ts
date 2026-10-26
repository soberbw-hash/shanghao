import assert from "node:assert/strict";
import test from "node:test";
import { MemberPresenceState, MemberSpeakingState, type RoomMember } from "@private-voice/shared";
import { memberAvailabilityPresentation } from "../src/renderer/src/features/room/memberAvailability";
import { memberStatus } from "../src/renderer/src/features/voice-scene/activityRules";

test("phone consistently masks all away statuses and restores them without modifying member data", () => {
  for (const availabilityStatus of [undefined, "eating", "away", "restroom"] as const) {
    const member = {
      id: "friend",
      nickname: "朋友",
      sceneZone: "gameDesk1",
      availabilityStatus,
      callModeActive: false,
      presenceState: MemberPresenceState.Online,
      speakingState: MemberSpeakingState.Silent,
      isMuted: true,
      gameName: "英雄联盟",
    } as RoomMember;
    const before = memberAvailabilityPresentation(member);
    assert.equal(
      memberAvailabilityPresentation({ ...member, callModeActive: true })?.label,
      "通话中",
    );
    assert.equal(memberStatus({ ...member, callModeActive: true }).label, "通话中");
    assert.deepEqual(memberAvailabilityPresentation(member), before);
    if (availabilityStatus) assert.equal(memberStatus(member).label, before?.label);
    assert.equal(member.availabilityStatus, availabilityStatus);
  }
  assert.equal(
    memberAvailabilityPresentation({ sceneZone: "restroomZone", callModeActive: true })?.label,
    "通话中",
  );
});
