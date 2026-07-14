import assert from "node:assert/strict";
import test from "node:test";

import { isSignalEnvelope } from "../../../packages/signaling/src/protocol";
import { normalizePresenceGameName } from "../src/renderer/src/features/room/presenceSignal";

test("presence game names omit empty values and stay within protocol limits", () => {
  assert.equal(normalizePresenceGameName(), undefined);
  assert.equal(normalizePresenceGameName("   "), undefined);
  assert.equal(normalizePresenceGameName("  英雄联盟  "), "英雄联盟");
  assert.equal(normalizePresenceGameName("x".repeat(80))?.length, 64);

  const payload = {
    type: "member_state",
    roomId: "main",
    peerId: "peer-a",
    gameName: normalizePresenceGameName("   "),
  } as const;
  const serialized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  assert.equal("gameName" in serialized, false);
  assert.equal(isSignalEnvelope(serialized), true);
});

test("server protocol remains compatible with the v0.1.50 empty game name", () => {
  assert.equal(
    isSignalEnvelope({
      type: "member_state",
      roomId: "main",
      peerId: "peer-a",
      gameName: "",
    }),
    true,
  );
});
