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
    store.recordGame("main", "peer-a", "英雄联盟", at("2026-08-10T20:12:00"));
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
    assert.equal(main[0]?.messageCount, 1);
    assert.equal(main[0]?.screenShareCount, 1);
    assert.deepEqual(main[0]?.games, [{ name: "英雄联盟", participantCount: 1 }]);
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
