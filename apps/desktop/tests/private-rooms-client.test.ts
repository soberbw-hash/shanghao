import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AccountSnapshot, PrivateRoomInfo } from "@private-voice/shared";
import { PrivateRoomHistoryStore } from "../src/main/private-room-history";
import { PrivateRoomsDesktopService } from "../src/main/private-rooms-service";
import { decideSignalingError } from "../src/renderer/src/features/room/signalingErrorPolicy";
import {
  registerRoomRecordingFinalizer,
  finishRoomRecordingBeforeRelease,
} from "../src/renderer/src/features/recording/roomRecordingOwnership";

const room = (id = "a".repeat(32), code = "000001"): PrivateRoomInfo => ({
  roomId: `room_${id}`,
  channelCode: code,
  name: "夜间开黑",
  icon: "moon",
  ownerId: "user0",
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  onlineCount: 0,
  capacity: 5,
});
const temporary = async (t: Parameters<Parameters<typeof test>[1]>[0]) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-private-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("private room history separates accounts and servers and serializes concurrent writes", async (t) => {
  const directory = await temporary(t);
  const store = new PrivateRoomHistoryStore(directory);
  const a = room();
  const b = room("b".repeat(32), "000002");
  await Promise.all([
    store.favorite("server|user0", a, true),
    store.favorite("server|user0", b, true),
  ]);
  assert.equal((await store.read("server|user0")).favorites.length, 2);
  assert.equal((await store.read("server|user0")).lastRoomId, undefined);
  await store.remember("server|user0", a);
  await store.remember("server|user0", { ...a, name: "改名后" });
  const restarted = await new PrivateRoomHistoryStore(directory).read("server|user0");
  assert.equal(restarted.lastRoomId, a.roomId);
  assert.equal(restarted.recent.length, 1);
  assert.equal(restarted.favorites.find((entry) => entry.roomId === a.roomId)?.name, "改名后");
  assert.equal((await store.read("server|user1")).recent.length, 0);
  assert.equal((await store.read("another-server|user0")).favorites.length, 0);
  await store.removeFavorite("server|user0", a.roomId);
  assert.equal((await store.read("server|user0")).lastRoomId, a.roomId);
});

test("a corrupt private room history cannot be overwritten by a favorite or successful join", async (t) => {
  const directory = await temporary(t);
  const scope = "server|user0";
  const file = path.join(
    directory,
    "private-rooms",
    `${createHash("sha256").update(scope).digest("hex")}.json`,
  );
  await mkdir(path.dirname(file));
  const original = '{"version":999,"recent":[]}';
  await writeFile(file, original);
  const store = new PrivateRoomHistoryStore(directory);
  await assert.rejects(store.remember(scope, room()), /room_history_unreadable/);
  await assert.rejects(store.favorite(scope, room(), true), /room_history_unreadable/);
  assert.equal(await readFile(file, "utf8"), original);
});

test("oversized or duplicate private history is retained and cannot be replaced", async (t) => {
  const directory = await temporary(t);
  const scope = "server|user0";
  const file = path.join(
    directory,
    "private-rooms",
    `${createHash("sha256").update(scope).digest("hex")}.json`,
  );
  await mkdir(path.dirname(file));
  for (const original of [
    " ".repeat(256 * 1024 + 1),
    JSON.stringify({ version: 1, recent: [room(), room()], favorites: [] }),
  ]) {
    await writeFile(file, original);
    const store = new PrivateRoomHistoryStore(directory);
    await assert.rejects(store.read(scope), /room_history_unreadable/);
    await assert.rejects(store.remember(scope, room()), /room_history_unreadable/);
    assert.equal(await readFile(file, "utf8"), original);
  }
});

test("room commands keep tokens in Main, preserve zero-prefixed codes and reject wrong identities", async (t) => {
  const directory = await temporary(t);
  let snapshot: AccountSnapshot = {
    status: "signed_in",
    configured: true,
    guestAllowed: false,
    profile: { userId: "user0", username: "user0", displayName: "User0" },
  };
  let requests = 0;
  let reply: unknown = room();
  const service = new PrivateRoomsDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "fixture-token" },
    () => "wss://fixture.invalid/",
    new PrivateRoomHistoryStore(directory),
    (async (url, init) => {
      requests++;
      assert.match(String(url), /^https:\/\/fixture\.invalid\/api\/rooms/);
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer fixture-token");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal);
      return Response.json(reply);
    }) as typeof fetch,
  );
  assert.equal((await service.find("000001")).channelCode, "000001");
  await assert.rejects(service.find("1"), /room_invalid_request/);
  await assert.rejects(service.create({ icon: "untrusted" as never }), /room_invalid_request/);
  assert.equal(requests, 1);
  reply = room("b".repeat(32));
  await assert.rejects(service.get(room().roomId), /room_server_invalid_response/);
  snapshot = { ...snapshot, status: "signed_out", profile: undefined };
  await assert.rejects(service.mine(), /account_session_expired/);
});

test("oversized and legacy server responses fail naturally and release command admission", async (t) => {
  const directory = await temporary(t);
  let mode = "large";
  const service = new PrivateRoomsDesktopService(
    {
      getSnapshot: () => ({
        status: "signed_in",
        configured: true,
        guestAllowed: false,
        profile: { userId: "user0", username: "user0", displayName: "User0" },
      }),
      getFreshAccessToken: async () => "fixture-token",
    },
    () => "wss://fixture.invalid/",
    new PrivateRoomHistoryStore(directory),
    (async () =>
      mode === "large"
        ? new Response("x".repeat(512 * 1024 + 1))
        : mode === "legacy"
          ? new Response("old server", { status: 404 })
          : Response.json(room())) as typeof fetch,
  );
  await assert.rejects(service.get(room().roomId), /room_server_invalid_response/);
  mode = "legacy";
  await assert.rejects(service.get(room().roomId), /room_server_upgrade_required/);
  mode = "ok";
  assert.equal((await service.get(room().roomId)).roomId, room().roomId);
});

test("owner removal, deletion, bans and a full reconnect all stop repeated room admission", () => {
  for (const code of ["room_removed", "room_not_found", "room_banned", "room_full"]) {
    const decision = decideSignalingError(
      { type: "error", code, message: "raw" },
      { hasJoinedOnce: true, joinAckReceived: false, appVersion: "3.3.1" },
    );
    assert.equal(decision.ignore, false);
    assert.equal(decision.stopReconnect, true);
    assert.equal(decision.reason, code);
  }
});

test("recording room release is single flight and an old owner cannot unregister its replacement", async () => {
  let release!: () => void;
  let calls = 0;
  const old = registerRoomRecordingFinalizer("old", async () => {
    throw new Error("old_owner");
  });
  const remove = registerRoomRecordingFinalizer("new", () => {
    calls++;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  old();
  const one = finishRoomRecordingBeforeRelease();
  const two = finishRoomRecordingBeforeRelease();
  assert.strictEqual(one, two);
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await one;
  remove();
  await finishRoomRecordingBeforeRelease();
  const failing = registerRoomRecordingFinalizer("failed", async () => {
    throw new Error("seal_failed");
  });
  await assert.rejects(finishRoomRecordingBeforeRelease(), /seal_failed/);
  failing();
  await finishRoomRecordingBeforeRelease();
});
