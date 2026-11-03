import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRecycleRecording,
  selectRecordingMaintenanceBatch,
} from "../src/main/recording-recycle-maintenance";
import type { RecordingLibraryItem } from "@private-voice/shared";
test("only measured silence or explicitly enabled positive durations at most five minutes qualify", () => {
  for (const durationMs of [1, 180_000, 300_000])
    assert.equal(
      shouldRecycleRecording({ filePath: "file", reason: "too_short", durationMs }, true),
      true,
    );
  for (const durationMs of [undefined, 0, -1, NaN, Infinity, 300_001, 600_000])
    assert.equal(
      shouldRecycleRecording({ filePath: "file", reason: "too_short", durationMs }, true),
      false,
    );
  assert.equal(
    shouldRecycleRecording({ filePath: "file", reason: "too_short", durationMs: 5000 }, false),
    false,
  );
  assert.equal(
    shouldRecycleRecording({ filePath: "file", reason: "unreadable", durationMs: 5000 }, true),
    false,
  );
  assert.equal(shouldRecycleRecording(undefined, true), false);
  assert.equal(shouldRecycleRecording({ filePath: "file", reason: "silent" }, false), true);
});
test("bounded maintenance rotates past long files, prioritizes the newest finalized file and protects recent writes", () => {
  const now = Date.now();
  const items = Array.from(
    { length: 25 },
    (_, i) =>
      ({
        filePath: `file-${i}`,
        isFavorite: false,
        markers: [],
        modifiedAt: new Date(now - 300_000).toISOString(),
      }) as unknown as RecordingLibraryItem,
  );
  items[0]!.isFavorite = true;
  items[1]!.markers = [{ id: "marker", offsetMs: 0, createdAt: "" }];
  items[2]!.modifiedAt = new Date(now).toISOString();
  let cursor = 0;
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const batch = selectRecordingMaintenanceBatch(items, cursor, undefined, now);
    cursor = batch.cursor;
    assert.ok(batch.items.length <= 8);
    batch.items.forEach((item) => seen.add(item.filePath));
  }
  assert.equal(seen.size, 22);
  assert.equal(seen.has("file-2"), false);
  const manual = selectRecordingMaintenanceBatch(items, 10, "file-2", now);
  assert.equal(manual.items[0]?.filePath, "file-2");
  assert.ok(manual.items.length <= 8);
});
