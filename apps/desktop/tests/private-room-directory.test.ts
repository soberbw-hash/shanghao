import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ROOM_CODE_COOLDOWN_MS } from "@private-voice/shared";
import { PrivateRoomDirectory } from "../../../packages/signaling/src/private-room-directory";

test("concurrent create enforces channel uniqueness and three rooms per owner", async () => {
  const directory = await PrivateRoomDirectory.open();
  const collision = await Promise.allSettled([
    directory.create("alice", "A", { channelCode: "000000" }),
    directory.create("bob", "B", { channelCode: "000000" }),
  ]);
  assert.equal(collision.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(directory.find("000000").channelCode, "000000");
  const create = await Promise.allSettled(
    Array.from({ length: 10 }, () => directory.create("other", "O", {})),
  );
  assert.equal(create.filter((result) => result.status === "fulfilled").length, 3);
  assert.equal(new Set(directory.ownedBy("other").map((room) => room.channelCode)).size, 3);
});

test("delete cooldown expires but previous room identity can never resolve a reused code", async () => {
  let now = Date.now();
  const directory = await PrivateRoomDirectory.open(undefined, () => now);
  const room = await directory.create("a", "A", { channelCode: "012345" });
  await directory.delete(room.roomId, "a");
  assert.throws(() => directory.get(room.roomId), /room_not_found/);
  await assert.rejects(
    directory.create("b", "B", { channelCode: "012345" }),
    /room_code_unavailable/,
  );
  now += ROOM_CODE_COOLDOWN_MS;
  const reused = await directory.create("b", "B", { channelCode: "012345" });
  assert.notEqual(reused.roomId, room.roomId);
  assert.throws(() => directory.get(room.roomId), /room_not_found/);
});

test("durable metadata and bans survive restart while name and icon do not change identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-room-directory-"));
  const file = path.join(root, "rooms.json");
  try {
    let directory = await PrivateRoomDirectory.open(file);
    const room = await directory.create("a", "A", { channelCode: "520131" });
    await directory.ban(room.roomId, "a", "b", "B");
    await assert.rejects(
      directory.update("b", { roomId: room.roomId, name: "wrong", icon: "moon" }),
      /room_owner_required/,
    );
    const renamed = await directory.update("a", {
      roomId: room.roomId,
      name: "深夜上号",
      icon: "moon",
    });
    assert.equal(renamed.channelCode, room.channelCode);
    assert.equal(renamed.roomId, room.roomId);
    directory = await PrivateRoomDirectory.open(file);
    assert.equal(directory.get(room.roomId).name, "深夜上号");
    assert.throws(() => directory.assertCanJoin(room.roomId, "b"), /room_banned/);
    assert.equal(directory.assertCanJoin(room.roomId, "c").onlineCount, 0);
    assert.throws(() => directory.bans(room.roomId, "b"), /room_owner_required/);
    await directory.unban(room.roomId, "a", "b");
    assert.equal(directory.assertCanJoin(room.roomId, "b").roomId, room.roomId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corruption is preserved and failed commits never publish a room", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-room-damaged-"));
  const file = path.join(root, "rooms.json");
  try {
    await writeFile(file, "damaged");
    await assert.rejects(PrivateRoomDirectory.open(file));
    assert.equal(await readFile(file, "utf8"), "damaged");
    const blocked = path.join(root, "blocked", "rooms.json");
    const directory = await PrivateRoomDirectory.open(blocked);
    await writeFile(path.join(root, "blocked"), "not a directory");
    await assert.rejects(directory.create("a", "A", { channelCode: "123456" }));
    assert.equal(directory.available("123456"), true);
    assert.equal(directory.ownedBy("a").length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("request validation rejects arbitrary icons, codes, names and owner bans", async () => {
  const directory = await PrivateRoomDirectory.open();
  for (const request of [
    { channelCode: "123" },
    { channelCode: 123456 },
    { name: "\u0000" },
    { name: "x".repeat(33) },
    { icon: "uploaded" },
  ]) {
    assert.throws(() => directory.create("a", "A", request as never), /room_invalid_request/);
  }
  const room = await directory.create("a", "A", {});
  await assert.rejects(directory.ban(room.roomId, "a", "a", "A"), /room_invalid_request/);
  assert.equal(Object.hasOwn(room, "bans"), false);
});
