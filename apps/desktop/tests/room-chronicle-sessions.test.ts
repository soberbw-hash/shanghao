import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RoomChronicleSessions } from "../../../packages/signaling/src/room-chronicle-sessions";

test("chronicle isolates rooms, explicit participation, membership and session generations", () => {
  const sessions = new RoomChronicleSessions();
  const id = sessions.start("room-a", "a", ["a", "b"]);
  assert.equal(sessions.start("room-a", "b", ["a", "b"]), id);
  assert.equal(sessions.canSubmit("room-a", id, "a"), false);
  sessions.participate("room-a", id, "a", true);
  assert.equal(sessions.canSubmit("room-a", id, "a"), true);
  const revision = sessions.submissionRevision("room-a", id, "a");
  sessions.appendSubmission("room-a", id, "a", revision, { id: "one", at: 1, text: "内容" });
  sessions.appendSubmission("room-a", id, "a", revision, { id: "one", at: 1, text: "重复" });
  assert.equal(sessions.read("room-a", id, "b").length, 1);
  assert.throws(() => sessions.read("room-b", id, "b"), /forbidden/);
  sessions.updateMembers("room-a", ["b"]);
  assert.equal(sessions.canSubmit("room-a", id, "a"), false);
  sessions.stop("room-a", id, "b");
  const next = sessions.start("room-a", "b", ["b"]);
  assert.notEqual(next, id);
  assert.throws(
    () =>
      sessions.appendSubmission("room-a", id, "a", revision, { id: "late", at: 2, text: "迟到" }),
    /forbidden/,
  );
  assert.deepEqual(sessions.read("room-a", next, "b"), []);
});

test("late recognition cannot add an entry after consent withdrawal or membership change", () => {
  const sessions = new RoomChronicleSessions();
  const id = sessions.start("r", "a", ["a", "b"]);
  sessions.participate("r", id, "a", true);
  const revision = sessions.submissionRevision("r", id, "a");
  sessions.participate("r", id, "a", false);
  sessions.participate("r", id, "a", true);
  assert.throws(
    () => sessions.appendSubmission("r", id, "a", revision, { id: "late", at: 1, text: "旧结果" }),
    /stale/,
  );
  const next = sessions.submissionRevision("r", id, "a");
  sessions.updateMembers("r", ["a", "b", "c"]);
  assert.throws(
    () => sessions.appendSubmission("r", id, "a", next, { id: "late2", at: 2, text: "旧结果" }),
    /stale/,
  );
  assert.deepEqual(sessions.read("r", id, "a"), []);
});
