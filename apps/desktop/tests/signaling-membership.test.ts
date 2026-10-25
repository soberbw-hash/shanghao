import assert from "node:assert/strict";
import test from "node:test";
import { SignalingMembership } from "../src/main/signaling-membership";
test("control membership requires authenticated join and complete session generations; ignores cross-room and stale snapshots", () => {
  const membership = new SignalingMembership();
  const a = {
    id: "alice",
    userId: "user-a",
    memberSessionId: "session-a",
    memberGeneration: 1,
    nickname: "甲",
  };
  const b = {
    id: "bob",
    userId: "user-b",
    memberSessionId: "session-b",
    memberGeneration: 1,
    nickname: "乙",
  };
  const snapshot = (revision: number, members = [a, b]) => ({
    type: "room_snapshot",
    roomId: "room_test",
    revision,
    members,
  });
  membership.observe(snapshot(1));
  assert.equal(membership.get(), undefined);
  membership.observe({ type: "join_ack", roomId: "room_test", peerId: "alice" });
  membership.observe(snapshot(1));
  assert.equal(membership.get()?.host.deviceId, "user-a");
  membership.observe({ ...snapshot(99), roomId: "other" });
  assert.equal(membership.get()?.roomId, "room_test");
  membership.observe(snapshot(2, [a, { ...b, memberGeneration: 2 }]));
  membership.observe(snapshot(1));
  assert.equal(membership.get()?.members[1]?.memberGeneration, 2);
  membership.observe(snapshot(3, [a, { ...b, memberSessionId: "" }]));
  assert.equal(membership.get(), undefined);
  membership.clear();
  membership.observe(snapshot(4));
  assert.equal(membership.get(), undefined);
});
