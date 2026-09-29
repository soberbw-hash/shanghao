import assert from "node:assert/strict";
import test from "node:test";

import type { RoomMember } from "@private-voice/shared";

import { MemberPresenceTracker } from "../src/renderer/src/features/room/memberPresenceTracker";

const remote = (id: string) => ({ id, isEmptySlot: false, isLocal: false }) as RoomMember;

test("membership changes stay with their room connection across reconnects", () => {
  const first = new MemberPresenceTracker();
  assert.deepEqual(
    first.collect([remote("a")]).joined.map((member) => member.id),
    ["a"],
  );
  assert.deepEqual(first.collect([remote("a")]), { joined: [], left: [] });
  assert.deepEqual(first.collect([remote("b")]), {
    joined: [remote("b")],
    left: ["a"],
  });

  const nextConnection = new MemberPresenceTracker();
  assert.deepEqual(
    nextConnection.collect([remote("a")]).joined.map((member) => member.id),
    ["a"],
  );
  assert.deepEqual(first.collect([]).left, ["b"]);
});
