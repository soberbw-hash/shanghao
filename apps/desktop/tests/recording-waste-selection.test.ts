import assert from "node:assert/strict";
import test from "node:test";
import { createRecordingWasteSelection } from "../src/main/recording-waste-selection";
import type { RecordingCleanupScan } from "@private-voice/shared";

const scan: RecordingCleanupScan = {
  protectedCount: 2,
  candidates: [
    { filePath: "short.m4a", reason: "too_short", durationMs: 9000 },
    { filePath: "silent.m4a", reason: "silent", durationMs: 3600000 },
    { filePath: "unknown.m4a", reason: "unreadable" },
  ],
};

test("waste cleanup accepts only scanned choices and leaves unreadable or unselected files", async () => {
  const moved: string[] = [];
  const selection = createRecordingWasteSelection(async (candidate) => {
    moved.push(candidate.filePath);
  });
  await selection.scan(async () => scan);
  const result = await selection.clean(["silent.m4a", "unknown.m4a", "normal.m4a", "silent.m4a"]);
  assert.deepEqual(moved, ["silent.m4a"]);
  assert.deepEqual(result.deletedFilePaths, moved);
  assert.equal(result.failed.length, 2);
  assert.equal((await selection.clean(["short.m4a"])).deletedFilePaths.length, 1);
  assert.equal((await selection.clean(["silent.m4a"])).failed.length, 1);
});

test("failed recycling is retained and can be retried without repeating successful moves", async () => {
  let fail = true;
  const selection = createRecordingWasteSelection(async (candidate) => {
    if (fail && candidate.reason === "silent") throw new Error("occupied");
  });
  await selection.scan(async () => scan);
  const first = await selection.clean(["short.m4a", "silent.m4a"]);
  assert.deepEqual(first.deletedFilePaths, ["short.m4a"]);
  assert.equal(first.failed[0]?.message, "occupied");
  fail = false;
  assert.deepEqual((await selection.clean(["silent.m4a"])).deletedFilePaths, ["silent.m4a"]);
});

test("new scan failure revokes previous waste approvals", async () => {
  const selection = createRecordingWasteSelection(async () => {});
  await selection.scan(async () => scan);
  await assert.rejects(
    selection.scan(async () => {
      throw new Error("scan failed");
    }),
  );
  assert.equal(
    (await selection.clean(["short.m4a"])).failed[0]?.message,
    "recording_cleanup_rescan_required",
  );
});

test("cleanup rejects invalid requests and bounds native approvals to 500", async () => {
  const selection = createRecordingWasteSelection(async () => {});
  await assert.rejects(selection.clean([42]), /invalid_recording_cleanup_batch/);
  await assert.rejects(
    selection.clean(Array(501).fill("short.m4a")),
    /invalid_recording_cleanup_batch/,
  );
  const many = await selection.scan(async () => ({
    protectedCount: 0,
    candidates: Array.from({ length: 501 }, (_, index) => ({
      filePath: String(index),
      reason: "silent" as const,
    })),
  }));
  assert.equal(many.candidates.length, 500);
  assert.equal((await selection.clean(["500"])).failed.length, 1);
});

test("concurrent scan or cleanup cannot replace an active scan receipt", async () => {
  let release!: () => void;
  const selection = createRecordingWasteSelection(async () => {});
  const pending = selection.scan(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return scan;
  });
  await assert.rejects(selection.clean(["short.m4a"]), /recording_cleanup_busy/);
  await assert.rejects(
    selection.scan(async () => scan),
    /recording_cleanup_busy/,
  );
  release();
  await pending;
  assert.deepEqual((await selection.clean(["short.m4a"])).deletedFilePaths, ["short.m4a"]);
});
