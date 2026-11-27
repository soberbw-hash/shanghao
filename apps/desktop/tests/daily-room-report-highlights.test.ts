import assert from "node:assert/strict";
import test from "node:test";

import type { DailyRoomReport } from "@private-voice/shared";

import {
  buildDailyRoomReportFacts,
  buildDailyRoomReportHighlights,
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

test("a stats-only report has verifiable facts and no invented highlights", () => {
  assert.deepEqual(buildDailyRoomReportHighlights(base), []);
  assert.deepEqual(buildDailyRoomReportFacts(base), ["房间活跃 1 分钟", "1 人来过"]);
});

test("room activity facts use measured values and ignore saved prose", () => {
  const facts = buildDailyRoomReportFacts({
    ...base,
    participantCount: 3,
    activeDurationMs: 23 * 60 * 60_000 + 9 * 60_000,
    peakConcurrent: 3,
    peakConcurrentAt: "2026-08-19T00:44:00.000Z",
    commentary: "一号房三人三小时，这句话与统计冲突。\n不应该继续显示。",
    gameActivities: [{ nickname: "小明", gameName: "英雄联盟", durationMs: 7 * 60 * 60_000 }],
  });
  assert.deepEqual(facts, ["房间活跃 23 小时 9 分钟", "3 人来过", "检测到《英雄联盟》"]);
});

test("a tiny legacy game fragment is not promoted as the main game of an all-day room", () => {
  const report: DailyRoomReport = {
    ...base,
    participantCount: 3,
    activeDurationMs: 23 * 60 * 60_000 + 9 * 60_000,
    peakConcurrent: 3,
    gameActivities: [{ nickname: "小明", gameName: "KK 对战平台", durationMs: 42 * 60_000 }],
  };
  assert.deepEqual(buildDailyRoomReportFacts(report), ["房间活跃 23 小时 9 分钟", "3 人来过"]);
});

test("legacy moments are not used as an entire-day overview", () => {
  const moment = {
    title: "开团先开麦",
    description: "阿南发现自己一直静音",
    startMs: 100,
    endMs: 200,
  };
  const recap = {
    recordingId: "old",
    uploadedAt: "2026-08-19T10:00:00Z",
    description: "复盘配合",
    summary: ["约好周五继续开黑"],
    highlights: [],
    funnyMoments: [moment],
    participantNicknames: ["阿南"],
    keywords: [],
  };
  const report = {
    ...base,
    commentary: "昨晚大家聊了不少。",
    recordingRecaps: [recap, { ...recap, recordingId: "new" }],
  };
  const highlights = buildDailyRoomReportHighlights(report);
  assert.deepEqual(
    highlights.map(({ value, detail }) => [value, detail]),
    [],
  );
});

test("raw chronicle fragments stay out of the overview until a day-level summary exists", () => {
  const text = "小明提议下次也许可以试试双排。";
  const report = {
    ...base,
    chronicleRecaps: [
      { id: "scene-1", createdAt: "2026-08-19T13:00:00.000Z", text },
      { id: "scene-2", createdAt: "2026-08-19T13:01:00.000Z", text },
    ],
  };
  assert.deepEqual(
    buildDailyRoomReportHighlights(report).map((item) => item.value),
    [],
  );
  assert.deepEqual(
    buildDailyRoomReportHighlights({
      ...report,
      commentaryVersion: 2,
      commentary: "上午商量开黑时间，晚上才一起进游戏。",
    }).map((item) => item.value),
    ["上午商量开黑时间，晚上才一起进游戏。"],
  );
});
