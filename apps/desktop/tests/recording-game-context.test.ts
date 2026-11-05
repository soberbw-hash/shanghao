import assert from "node:assert/strict";
import test from "node:test";
import {
  isRecordingGameTimeline,
  recordingGameContextForRange,
} from "../src/main/recording-game-context";

test("game context uses only complete snapshots for the same room, member and time", () => {
  const timeline = {
    schemaVersion: 1 as const,
    roomId: "room-a",
    durationMs: 3000,
    complete: true,
    events: [
      { offsetMs: 0, memberId: "a", present: true, gameName: "英雄联盟" },
      { offsetMs: 0, memberId: "b", present: true, gameName: "CS2" },
      { offsetMs: 1000, memberId: "a", present: true, gameName: "无畏契约" },
      { offsetMs: 1500, memberId: "b", present: false },
    ],
  };
  assert.equal(isRecordingGameTimeline(timeline), true);
  assert.equal(isRecordingGameTimeline({ ...timeline, schemaVersion: 2 }), false);
  assert.deepEqual(recordingGameContextForRange(timeline, "room-a", "a", 100, 900), {
    gameName: "英雄联盟",
    terms: [],
  });
  assert.deepEqual(recordingGameContextForRange(timeline, "room-a", "b", 100, 900), {
    gameName: "CS2",
    terms: [],
  });
  assert.equal(recordingGameContextForRange(timeline, "room-a", "a", 900, 1100), undefined);
  assert.equal(recordingGameContextForRange(timeline, "room-a", "b", 1500, 2000), undefined);
  assert.equal(recordingGameContextForRange(timeline, "room-b", "a", 100, 900), undefined);
  assert.equal(recordingGameContextForRange(timeline, "room-a", "unknown", 100, 900), undefined);
  assert.equal(
    recordingGameContextForRange({ ...timeline, complete: false }, "room-a", "a", 100, 900),
    undefined,
  );
  assert.equal(recordingGameContextForRange(undefined, "room-a", "a", 100, 900), undefined);
});

test("malformed and reordered snapshots are not interpreted as historical facts", () => {
  const bad = {
    schemaVersion: 1 as const,
    roomId: "r",
    durationMs: 2000,
    complete: true,
    events: [
      { offsetMs: 900, memberId: "a", present: true, gameName: "A" },
      { offsetMs: 100, memberId: "a", present: true, gameName: "B" },
    ],
  };
  assert.equal(isRecordingGameTimeline(bad), false);
  assert.equal(recordingGameContextForRange(bad, "r", "a", 1000, 1500), undefined);
});
