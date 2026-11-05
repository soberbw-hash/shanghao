import assert from "node:assert/strict";
import test from "node:test";
import { createRecordingGameTimeline } from "../src/renderer/src/features/recording/recordingGameTimeline";

test("recording snapshots stay scoped to the actual room, member and observed time", () => {
  const timeline = createRecordingGameTimeline("room-a", 1000);
  timeline.capture(
    "room-a",
    [
      { id: "one", userId: "account-a", gameName: "英雄联盟" },
      { id: "two", gameName: "CS2" },
    ],
    1000,
  );
  timeline.capture(
    "room-a",
    [
      { id: "one", userId: "account-a", gameName: "英雄联盟" },
      { id: "two", gameName: "CS2" },
    ],
    1200,
  );
  timeline.capture("room-a", [{ id: "one", userId: "account-a", gameName: "无畏契约" }], 2000);
  const result = timeline.finish(3000);
  assert.deepEqual(result, {
    schemaVersion: 1,
    roomId: "room-a",
    durationMs: 2000,
    complete: true,
    events: [
      { offsetMs: 0, memberId: "account-a", present: true, gameName: "英雄联盟" },
      { offsetMs: 0, memberId: "two", present: true, gameName: "CS2" },
      { offsetMs: 1000, memberId: "account-a", present: true, gameName: "无畏契约" },
      { offsetMs: 1000, memberId: "two", present: false },
    ],
  });
  timeline.capture("room-a", [], 4000);
  assert.equal(timeline.finish(5000).durationMs, 2000);
});

test("room changes and event overflow mark snapshots incomplete rather than guessing", () => {
  const timeline = createRecordingGameTimeline("room-a", 0);
  timeline.capture("room-b", [{ id: "other", gameName: "CS2" }], 10);
  assert.deepEqual(timeline.finish(20), {
    schemaVersion: 1,
    roomId: "room-a",
    durationMs: 20,
    complete: false,
    events: [],
  });
  const busy = createRecordingGameTimeline("room-a", 0);
  for (let i = 0; i < 2002; i++)
    busy.capture("room-a", [{ id: "one", gameName: i % 2 ? "A" : "B" }], i);
  assert.equal(busy.finish(2003).complete, false);
  assert.equal(busy.finish(2003).events.length, 2000);
});
