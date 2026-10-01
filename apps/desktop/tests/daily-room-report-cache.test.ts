import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { DailyRoomReport } from "@private-voice/shared";

import { DailyRoomReportCache } from "../src/main/daily-room-report-cache";

const report = (roomId: string, date: string): DailyRoomReport => ({
  roomId,
  date,
  hadActivity: true,
  participantCount: 2,
  participantNicknames: ["Sober", "老王"],
  activeDurationMs: 60_000,
  peakConcurrent: 2,
  messageCount: 3,
  screenShareCount: 0,
  games: [],
  gameActivities: [],
});

test("daily room reports survive a client restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-room-reports-"));
  const first = new DailyRoomReportCache(directory);
  await first.save({ main: [report("main", "2026-08-13")], side: [] });

  const restarted = new DailyRoomReportCache(directory);
  assert.deepEqual(await restarted.read(), {
    main: [report("main", "2026-08-13")],
    side: [],
  });
  assert.match(
    await readFile(path.join(directory, "daily-room-reports.json"), "utf8"),
    /2026-08-13/,
  );
});

test("daily room report cache rejects malformed entries without discarding valid data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-room-reports-"));
  const cache = new DailyRoomReportCache(directory);
  await cache.save({
    main: [report("main", "2026-08-12"), { date: "broken" } as DailyRoomReport],
    side: [report("side", "2026-08-11")],
  });

  const stored = await new DailyRoomReportCache(directory).read();
  assert.equal(stored.main.length, 1);
  assert.equal(stored.side.length, 1);
});

test("daily room report cache refuses to overwrite unreadable user data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-room-reports-"));
  const file = path.join(directory, "daily-room-reports.json");
  try {
    const original = JSON.stringify({ version: 2, reports: { main: [], side: [] } });
    await writeFile(file, original, "utf8");
    const cache = new DailyRoomReportCache(directory);
    await assert.rejects(cache.read(), /daily_room_reports_unreadable/);
    await assert.rejects(
      cache.save({ main: [report("main", "2026-09-28")], side: [] }),
      /daily_room_reports_unreadable/,
    );
    assert.equal(await readFile(file, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private room reports survive restart without replacing legacy or another private room", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-private-reports-"));
  try {
    const a = `room_${"a".repeat(32)}`;
    const b = `room_${"b".repeat(32)}`;
    const cache = new DailyRoomReportCache(directory);
    await cache.save({ main: [report("main", "2026-09-28")], [a]: [report(a, "2026-09-29")] });
    await cache.save({ [b]: [report(b, "2026-09-29")] });
    const reports = await new DailyRoomReportCache(directory).read();
    assert.equal(reports[a]?.[0]?.roomId, a);
    assert.equal(reports[b]?.[0]?.roomId, b);
    assert.equal(reports.main?.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
