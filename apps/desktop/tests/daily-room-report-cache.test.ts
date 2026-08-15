import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { DailyRoomReport } from "@private-voice/shared";

import { DailyRoomReportCache } from "../src/main/daily-room-report-cache";

const report = (roomId: "main" | "side", date: string): DailyRoomReport => ({
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
