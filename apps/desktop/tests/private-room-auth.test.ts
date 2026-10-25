import assert from "node:assert/strict";
import test from "node:test";
import type { AccountSnapshot, PrivateRoomInfo } from "@private-voice/shared";
import { PrivateRoomsDesktopService } from "../src/main/private-rooms-service";
import type { PrivateRoomHistoryStore } from "../src/main/private-room-history";

const room: PrivateRoomInfo = {
  roomId: `room_${"a".repeat(32)}`,
  channelCode: "001234",
  name: "Fixture",
  icon: "moon",
  ownerId: "fixture-account",
  capacity: 5,
  onlineCount: 0,
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T00:00:00.000Z",
};
function fixture(mode: "recover" | "reject" | "offline" | "switch" | "unavailable") {
  let snapshot: AccountSnapshot = {
    status: "signed_in",
    configured: true,
    guestAllowed: false,
    profile: { userId: "fixture-account", username: "fixture", displayName: "Fixture" },
  };
  const forced: boolean[] = [],
    sent: string[] = [];
  const service = new PrivateRoomsDesktopService(
    {
      getSnapshot: () => snapshot,
      getFreshAccessToken: async (force = false) => {
        forced.push(force);
        if (force && mode === "switch")
          snapshot = { ...snapshot, profile: { ...snapshot.profile!, userId: "other-account" } };
        return force ? "fixture-fresh" : "fixture-stale";
      },
    },
    () => "wss://fixture.invalid",
    {} as PrivateRoomHistoryStore,
    async (_url, init) => {
      sent.push((init?.headers as Record<string, string>).authorization);
      if (mode === "offline") throw Error("fixture network unavailable");
      if (sent.length === 1 || mode === "reject")
        return Response.json(
          { error: { code: "account_session_expired" } },
          { status: mode === "unavailable" ? 503 : 401 },
        );
      return Response.json(room);
    },
  );
  return { service, forced, sent };
}

test("an explicit server auth rejection refreshes once and retries with the fresh Main-only bearer", async () => {
  const f = fixture("recover");
  assert.equal((await f.service.get(room.roomId)).roomId, room.roomId);
  assert.deepEqual(f.forced, [false, true]);
  assert.deepEqual(f.sent, ["Bearer fixture-stale", "Bearer fixture-fresh"]);
  assert.equal(f.service.getPendingCount(), 0);
});

test("a repeated rejection is bounded and network failures never repeat room operations", async () => {
  const rejected = fixture("reject");
  await assert.rejects(rejected.service.get(room.roomId), /account_session_expired/);
  assert.equal(rejected.sent.length, 2);
  assert.equal(rejected.service.getPendingCount(), 0);
  const offline = fixture("offline");
  await assert.rejects(offline.service.get(room.roomId), /fixture network unavailable/);
  assert.deepEqual(offline.forced, [false]);
  assert.equal(offline.sent.length, 1);
  const unavailable = fixture("unavailable");
  await assert.rejects(unavailable.service.get(room.roomId), /account_session_expired/);
  assert.deepEqual(unavailable.forced, [false]);
  assert.equal(unavailable.sent.length, 1, "an error code without HTTP 401 cannot cause a retry");
});

test("an account switch during forced refresh prevents the rejected command being sent under another user", async () => {
  const f = fixture("switch");
  await assert.rejects(f.service.get(room.roomId), /account_session_expired/);
  assert.deepEqual(f.forced, [false, true]);
  assert.deepEqual(f.sent, ["Bearer fixture-stale"]);
});
