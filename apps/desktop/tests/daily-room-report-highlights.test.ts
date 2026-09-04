import assert from "node:assert/strict";
import test from "node:test";

import type { DailyRoomReport } from "@private-voice/shared";

import {
  buildDailyRoomReportHighlights,
  buildDailyRoomReportNarrative,
} from "../src/renderer/src/features/daily-report/dailyRoomReportHighlights";

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
  assert.deepEqual(
    buildDailyRoomReportHighlights(base).map((highlight) => highlight.id),
    ["room-title"],
  );
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
    ["main-game", "peak", "room-title"],
  );
});

test("daily narrative uses measured values instead of saved generated commentary", () => {
  const narrative = buildDailyRoomReportNarrative({
    ...base,
    participantCount: 3,
    activeDurationMs: 23 * 60 * 60_000 + 9 * 60_000,
    peakConcurrent: 3,
    peakConcurrentAt: "2026-08-19T00:44:00.000Z",
    commentary: "一号房三人三小时，这句话与统计冲突。\n不应该继续显示。",
    gameActivities: [{ nickname: "小明", gameName: "英雄联盟", durationMs: 7 * 60 * 60_000 }],
  });
  assert.match(narrative, /23 小时 9 分钟/);
  assert.match(narrative, /英雄联盟/);
  assert.match(narrative, /7 小时/);
  assert.match(narrative, /08:44/);
  assert.doesNotMatch(narrative, /三人三小时/);
});

test("a tiny legacy game fragment is not promoted as the main game of an all-day room", () => {
  const report: DailyRoomReport = {
    ...base,
    participantCount: 3,
    activeDurationMs: 23 * 60 * 60_000 + 9 * 60_000,
    peakConcurrent: 3,
    gameActivities: [{ nickname: "小明", gameName: "KK 对战平台", durationMs: 42 * 60_000 }],
  };
  assert.equal(
    buildDailyRoomReportHighlights(report).some((highlight) => highlight.id === "main-game"),
    false,
  );
  assert.doesNotMatch(buildDailyRoomReportNarrative(report), /KK 对战平台/);
});
