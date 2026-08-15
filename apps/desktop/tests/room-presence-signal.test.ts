import assert from "node:assert/strict";
import test from "node:test";

import { isSignalEnvelope } from "../../../packages/signaling/src/protocol";
import {
  normalizePresenceGameIconDataUrl,
  normalizePresenceGameName,
  resolvePresenceGameNameUpdate,
} from "../src/renderer/src/features/room/presenceSignal";

test("presence game names send an explicit empty value and stay within protocol limits", () => {
  assert.equal(normalizePresenceGameName(), undefined);
  assert.equal(normalizePresenceGameName("   "), undefined);
  assert.equal(normalizePresenceGameName("  英雄联盟  "), "英雄联盟");
  assert.equal(normalizePresenceGameName("KK RPG"), "KK 对战平台");
  assert.equal(normalizePresenceGameName("KKRPG - 向魔兽开炮"), "KK 对战平台");
  assert.equal(normalizePresenceGameName("英雄三国"), "KK 对战平台");
  assert.equal(normalizePresenceGameName("x".repeat(80))?.length, 64);

  const payload = {
    type: "member_state",
    roomId: "main",
    peerId: "peer-a",
    gameName: normalizePresenceGameName("   ") ?? "",
  } as const;
  const serialized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  assert.equal(serialized.gameName, "");
  assert.equal(isSignalEnvelope(serialized), true);
});

test("KK platform activity never exposes a hosted game's runtime icon", () => {
  const hostedGameIcon = "data:image/png;base64,hero-game-icon";
  assert.equal(normalizePresenceGameIconDataUrl("KK 对战平台", hostedGameIcon), undefined);
  assert.equal(normalizePresenceGameIconDataUrl("KK RPG", hostedGameIcon), undefined);
  assert.equal(normalizePresenceGameIconDataUrl("英雄三国", hostedGameIcon), undefined);
  assert.equal(normalizePresenceGameIconDataUrl("英雄联盟", hostedGameIcon), hostedGameIcon);
});

test("presence clears stale game state from current and legacy server broadcasts", () => {
  assert.equal(resolvePresenceGameNameUpdate("KK 对战平台", "", "idle"), undefined);
  assert.equal(resolvePresenceGameNameUpdate("KK 对战平台", undefined, "idle"), undefined);
  assert.equal(resolvePresenceGameNameUpdate("KK 对战平台", undefined, undefined), "KK 对战平台");
  assert.equal(resolvePresenceGameNameUpdate(undefined, "  英雄联盟  ", "gaming"), "英雄联盟");
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
