import assert from "node:assert/strict";
import test from "node:test";
import type { RecordingLibraryItem, RecordingLibrarySnapshot } from "@private-voice/shared";
import { cleanSilentRecordings } from "../src/main/automatic-recording-cleanup";

const item = (id: string): RecordingLibraryItem => ({
  id,
  recordingId: id,
  filePath: `${id}.m4a`,
  fileName: `${id}.m4a`,
  mediaUrl: "",
  title: id,
  createdAt: "2026-10-20T00:00:00Z",
  modifiedAt: "2026-10-20T00:00:00Z",
  fileSize: 100,
  isFavorite: false,
  markers: [],
});
test("capacity pressure cannot bypass silent-only policy and only verified silent files are recycled", async () => {
  const items = [
    item("new-short"),
    item("silent-old"),
    item("audible-old"),
    { ...item("favorite"), isFavorite: true },
  ];
  const recycled: string[] = [];
  const probed: string[] = [];
  const result = await cleanSilentRecordings({
    enabled: true,
    newestFilePath: items[0]!.filePath,
    read: async () => ({ items, totalBytes: 400, quotaBytes: 50 }) as RecordingLibrarySnapshot,
    inspect: async (entry) => {
      probed.push(entry.filePath);
      return {
        filePath: entry.filePath,
        reason: entry.id === "silent-old" ? "silent" : "too_short",
      };
    },
    recycle: async (entry) => {
      recycled.push(entry.filePath);
    },
  });
  assert.deepEqual(recycled, ["silent-old.m4a"]);
  assert.equal(probed.includes("favorite.m4a"), false);
  assert.deepEqual(
    result.deletedItems.map((entry) => entry.id),
    ["silent-old"],
  );
  assert.equal(result.quotaDeletedCount, 1);
});
test("disabled cleanup, unreadable audio and failed recycling preserve data", async () => {
  let reads = 0;
  const options = {
    newestFilePath: "new.m4a",
    read: async () => {
      reads++;
      return { items: [item("new")], totalBytes: 100, quotaBytes: 50 } as RecordingLibrarySnapshot;
    },
    inspect: async () => {
      throw new Error("probe_failed");
    },
    recycle: async () => {
      throw new Error("must_not_recycle");
    },
  };
  assert.equal(
    (await cleanSilentRecordings({ ...options, enabled: false })).deletedItems.length,
    0,
  );
  assert.equal(reads, 0);
  assert.equal((await cleanSilentRecordings({ ...options, enabled: true })).deletedItems.length, 0);
  const failed = await cleanSilentRecordings({
    ...options,
    enabled: true,
    inspect: async () => ({ filePath: "new.m4a", reason: "silent" as const }),
  });
  assert.equal(failed.deletedItems.length, 0);
});
test("large libraries have bounded maintenance and each immutable candidate is inspected once", async () => {
  const items = Array.from({ length: 1000 }, (_, i) => item(String(i)));
  const probed = new Set<string>();
  await cleanSilentRecordings({
    enabled: true,
    newestFilePath: items[0]!.filePath,
    read: async () => ({ items, totalBytes: 100000, quotaBytes: 50 }) as RecordingLibrarySnapshot,
    inspect: async (entry) => {
      assert.equal(probed.has(entry.id), false);
      probed.add(entry.id);
      return undefined;
    },
    recycle: async () => {
      assert.fail("unknown audio must be retained");
    },
  });
  assert.ok(probed.size <= 9);
});
