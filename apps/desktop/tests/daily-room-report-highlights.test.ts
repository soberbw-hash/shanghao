import assert from "node:assert/strict";
import test from "node:test";

import type { DailyRoomReport } from "@private-voice/shared";

import { buildDailyRoomReportHighlights } from "../src/renderer/src/features/daily-report/dailyRoomReportHighlights";

const base: DailyRoomReport = {
  roomId: "main",
  date: "2026-08-19",
  hadActivity: true,
  participantCount: 1,
  participantNicknames: ["小明"],
  activeDurationMs: 60_000,
  peakConcurrent: 1,
  messageCount: 0,
  screenShareCount: 0,
  games: [],
  gameActivities: [],
};

test("daily highlights are emitted only when backed by a positive metric", () => {
  assert.deepEqual(buildDailyRoomReportHighlights(base), []);
  const highlights = buildDailyRoomReportHighlights({
    ...base,
    peakConcurrent: 3,
    peakConcurrentAt: "2026-08-19T13:15:00.000Z",
    gameActivities: [{ nickname: "小明", gameName: "三角洲行动", durationMs: 3_600_000 }],
    participants: [
      {
        identityId: "profile-a",
        nickname: "小明",
        presenceDurationMs: 7_200_000,
        joinSessions: 1,
        gameDurationMs: 3_600_000,
        messageCount: 12,
        screenShareCount: 1,
        screenShareDurationMs: 600_000,
        firstSeenAt: "2026-08-19T12:00:00.000Z",
      },
    ],
  });
  assert.deepEqual(
    highlights.map((highlight) => highlight.id),
    ["presence", "gaming", "main-game", "messages", "sharing", "peak"],
  );
});
