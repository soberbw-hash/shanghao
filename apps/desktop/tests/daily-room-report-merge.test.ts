import assert from "node:assert/strict";
import test from "node:test";

import type { DailyRoomReport } from "@private-voice/shared";

import { mergeDailyRoomReports } from "../src/renderer/src/store/dailyRoomReportStore";

const report = (date: string, revision: number, messageCount: number): DailyRoomReport => ({
  schemaVersion: 1,
  revision,
  updatedAt: `2026-08-${date.slice(-2)}T12:00:00.000Z`,
  roomId: "main",
  date,
  hadActivity: true,
  participantCount: 1,
  participantNicknames: ["朋友"],
  activeDurationMs: 1_000,
  peakConcurrent: 1,
  messageCount,
  screenShareCount: 0,
  screenShareDurationMs: 0,
  games: [],
  gameActivities: [],
  participants: [],
});

test("daily report reconciliation keeps real local data when server history is empty", () => {
  const cached = [report("2026-08-10", 4, 7)];
  assert.deepEqual(mergeDailyRoomReports(cached, []), cached);
});

test("daily report reconciliation selects the newest revision per date", () => {
  const cached = report("2026-08-10", 4, 7);
  const server = report("2026-08-10", 5, 8);
  assert.equal(mergeDailyRoomReports([cached], [server])[0]?.messageCount, 8);
  assert.equal(mergeDailyRoomReports([server], [cached])[0]?.messageCount, 8);
});
