import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DailyRoomReportStore } from "../../../packages/signaling/src/daily-room-report-store";
import { DailyRoomCommentaryService } from "../../../packages/signaling/src/daily-room-commentary-service";

const roomA = `room_${"a".repeat(32)}`,
  roomB = `room_${"b".repeat(32)}`;
const recap = (description: string) => ({
  recordingId: "recap",
  description,
  summary: [description],
  highlights: [],
  funnyMoments: [],
  participantNicknames: [],
  keywords: [],
});
const now = Date.parse("2026-10-02T12:00:00+08:00");

test("daily summary prompt uses only the room's uploaded summaries and rejects stale commentary", async () => {
  const store = await DailyRoomReportStore.create();
  store.publishRecordingRecap(roomA, "2026-10-01", recap("房间A约饭"), now);
  store.publishRecordingRecap(roomB, "2026-10-01", recap("房间B秘密"), now);
  const report = store.getHistory(roomA, now)[0]!;
  let prompt = "";
  const commentary = new DailyRoomCommentaryService(Promise.resolve(store), {
    isConfigured: () => true,
    execute: async (request: { prompt: string }) => {
      prompt = request.prompt;
      store.publishRecordingRecap(roomA, "2026-10-01", recap("新上传的内容"), now + 1000);
      return '{"commentary":"这是旧版本的点评\\n不能覆盖新上传的内容"}';
    },
  } as never);
  await commentary.ensure(report);
  assert.ok(prompt.includes("房间A约饭"));
  assert.equal(prompt.includes("房间B秘密"), false);
  assert.equal(store.getHistory(roomA, now)[0]?.commentary, undefined);
});

test("waiting for summary persistence keeps live game and room counters running", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-report-write-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await DailyRoomReportStore.create(path.join(directory, "reports.json"));
  store.recordJoin(roomA, "person", "朋友", 1, now);
  store.recordGame(roomA, "person", "朋友", "英雄联盟", now);
  store.publishRecordingRecap(roomA, "2026-10-01", recap("一起玩游戏"), now);
  await store.flushWrites();
  store.recordLeave(roomA, "person", "朋友", 0, now + 600_000);
  const report = store.getHistory(roomA, now + 86_400_000)[0]!;
  assert.equal(report.activeDurationMs, 600_000);
  assert.equal(report.gameActivities?.[0]?.durationMs, 600_000);
  await store.flushWrites();
  const restored = await DailyRoomReportStore.create(path.join(directory, "reports.json"));
  assert.equal(restored.getHistory(roomA, now)[0]?.recordingRecaps?.[0]?.description, "一起玩游戏");
});

test("real disk failures reject durable upload confirmation", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-report-failure-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, "reports.json");
  await mkdir(destination);
  const store = await DailyRoomReportStore.create(destination);
  store.publishRecordingRecap(roomA, "2026-10-01", recap("不能假称已保存"), now);
  await assert.rejects(store.flushWrites(), /storage_failed/);
});
