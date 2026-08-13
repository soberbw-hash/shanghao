import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DailyRoomReportStore } from "../../../packages/signaling/src/daily-room-report-store";

const at = (value: string): number => Date.parse(`${value}+08:00`);

test("daily room reports retain 14 complete days and isolate the two rooms", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-daily-room-"));
  const filePath = path.join(directory, "daily-room.json");
  try {
    const store = await DailyRoomReportStore.create(filePath);
    store.recordJoin("main", "peer-a", "小明", 1, at("2026-08-10T20:00:00"));
    store.recordMessage("main", at("2026-08-10T20:10:00"));
    store.recordGame("main", "peer-a", "小明", "英雄联盟", at("2026-08-10T20:12:00"));
    store.recordScreenShare("main", "peer-a", true, at("2026-08-10T20:15:00"));
    store.recordLeave("main", "peer-a", "小明", 0, at("2026-08-10T21:00:00"));
    store.recordJoin("side", "peer-b", "小红", 1, at("2026-08-10T22:00:00"));
    store.recordLeave("side", "peer-b", "小红", 0, at("2026-08-10T22:20:00"));
    await store.flush();

    const reloaded = await DailyRoomReportStore.create(filePath);
    const main = reloaded.getHistory("main", at("2026-08-11T12:00:00"));
    const side = reloaded.getHistory("side", at("2026-08-11T12:00:00"));
    assert.equal(main.length, 14);
    assert.equal(main[0]?.date, "2026-08-10");
    assert.equal(main[0]?.participantCount, 1);
    assert.deepEqual(main[0]?.participantNicknames, ["小明"]);
    assert.equal(main[0]?.messageCount, 1);
    assert.equal(main[0]?.screenShareCount, 1);
    assert.deepEqual(main[0]?.games, [{ name: "英雄联盟", participantCount: 1 }]);
    assert.deepEqual(main[0]?.gameActivities, [
      { nickname: "小明", gameName: "英雄联盟", durationMs: 48 * 60 * 1_000 },
    ]);
    assert.equal(side[0]?.participantNicknames[0], "小红");
    assert.equal(main[1]?.hadActivity, false);
    assert.equal(side[1]?.hadActivity, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("screen sharing and reconnect-style duplicate joins are counted once", async () => {
  const store = await DailyRoomReportStore.create();
  const now = at("2026-08-10T20:00:00");
  store.recordJoin("main", "peer-a", "小明", 1, now);
  store.recordJoin("main", "peer-a", "小明", 1, now + 1_000);
  store.recordScreenShare("main", "peer-a", true, now + 2_000);
  store.recordScreenShare("main", "peer-a", true, now + 3_000);
  store.recordLeave("main", "peer-a", "小明", 0, now + 10_000);
  const report = store.getHistory("main", at("2026-08-11T12:00:00"))[0];
  assert.equal(report?.participantCount, 1);
  assert.equal(report?.screenShareCount, 1);
});

test("cross-midnight sessions are split in Shanghai time without a fake leave", async () => {
  const store = await DailyRoomReportStore.create();
  store.recordJoin("main", "profile-a", "小明", 1, at("2026-08-10T23:00:00"));
  store.recordLeave("main", "profile-a", "小明", 0, at("2026-08-11T02:00:00"));
  const history = store.getHistory("main", at("2026-08-12T12:00:00"));
  const secondDay = history.find((report) => report.date === "2026-08-11");
  const firstDay = history.find((report) => report.date === "2026-08-10");
  assert.equal(firstDay?.activeDurationMs, 60 * 60 * 1_000);
  assert.equal(secondDay?.activeDurationMs, 2 * 60 * 60 * 1_000);
  assert.equal(firstDay?.participantCount, 1);
  assert.equal(secondDay?.participantCount, 1);
  assert.equal(firstDay?.lastExit, undefined);
  assert.equal(secondDay?.lastExit?.nickname, "小明");
});

test("stable profile identity deduplicates nickname changes and game players across restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-daily-identity-"));
  const filePath = path.join(directory, "daily-room.json");
  try {
    const store = await DailyRoomReportStore.create(filePath);
    const now = at("2026-08-10T20:00:00");
    store.recordJoin("main", "profile-a", "旧昵称", 1, now);
    store.recordJoin("main", "profile-a", "新昵称", 1, now + 1_000);
    store.recordGame("main", "profile-a", "新昵称", "英雄联盟", now + 2_000);
    store.recordLeave("main", "profile-a", "新昵称", 0, now + 3_000);
    await store.flush();

    const reloaded = await DailyRoomReportStore.create(filePath);
    reloaded.recordGame("main", "profile-a", "新昵称", "英雄联盟", now + 4_000);
    reloaded.recordGame("main", "profile-a", "新昵称", undefined, now + 5_000);
    const report = reloaded.getHistory("main", at("2026-08-11T12:00:00"))[0];
    assert.equal(report?.participantCount, 1);
    assert.deepEqual(report?.participantNicknames, ["新昵称"]);
    assert.deepEqual(report?.games, [{ name: "英雄联盟", participantCount: 1 }]);
    await reloaded.flush();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("game activity records each friend, game duration, switching, and Shanghai midnight", async () => {
  const store = await DailyRoomReportStore.create();
  store.recordJoin("main", "profile-gramps", "gramps", 1, at("2026-08-10T22:30:00"));
  store.recordGame("main", "profile-gramps", "gramps", "三角洲行动", at("2026-08-10T23:00:00"));
  store.recordGame("main", "profile-gramps", "gramps", "英雄联盟", at("2026-08-11T01:00:00"));
  store.recordGame("main", "profile-gramps", "gramps", undefined, at("2026-08-11T01:30:00"));
  store.recordLeave("main", "profile-gramps", "gramps", 0, at("2026-08-11T01:31:00"));

  const history = store.getHistory("main", at("2026-08-12T12:00:00"));
  const august10 = history.find((report) => report.date === "2026-08-10");
  const august11 = history.find((report) => report.date === "2026-08-11");
  assert.deepEqual(august10?.gameActivities, [
    { nickname: "gramps", gameName: "三角洲行动", durationMs: 60 * 60 * 1_000 },
  ]);
  assert.deepEqual(august11?.gameActivities, [
    { nickname: "gramps", gameName: "三角洲行动", durationMs: 60 * 60 * 1_000 },
    { nickname: "gramps", gameName: "英雄联盟", durationMs: 30 * 60 * 1_000 },
  ]);
});
