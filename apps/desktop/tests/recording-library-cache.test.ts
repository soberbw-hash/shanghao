import assert from "node:assert/strict";
import test from "node:test";
import type { RecordingLibrarySnapshot } from "@private-voice/shared";
import { createRecordingLibraryCache } from "../src/renderer/src/features/recording/recordingLibraryCache";

const snapshot = (ids: string[]) =>
  ({ items: ids.map((id) => ({ id })) }) as RecordingLibrarySnapshot;

test("refresh after deletion reads disk rather than the preloaded library", async () => {
  let disk = snapshot(["deleted", "kept"]);
  let reads = 0;
  const cache = createRecordingLibraryCache(async () => {
    reads++;
    return disk;
  });
  await cache.read();
  disk = snapshot(["kept"]);
  assert.equal((await cache.read()).items.length, 2);
  assert.deepEqual(
    (await cache.read(true)).items.map((item) => item.id),
    ["kept"],
  );
  assert.equal(cache.peek(), disk);
  assert.equal(reads, 2);
});

test("older in-flight read cannot resurrect a deleted recording or clear the new request", async () => {
  const resolves: Array<(value: RecordingLibrarySnapshot) => void> = [];
  const cache = createRecordingLibraryCache(() => new Promise((resolve) => resolves.push(resolve)));
  const old = cache.read();
  const fresh = cache.read(true);
  resolves[0]!(snapshot(["deleted"]));
  await old;
  assert.equal(cache.read(), fresh);
  resolves[1]!(snapshot([]));
  await fresh;
  assert.deepEqual(cache.peek()?.items, []);
});

test("failed refresh discards stale cache and permits a retry", async () => {
  let failed = false;
  const cache = createRecordingLibraryCache(async () => {
    if (failed) throw new Error("read failed");
    return snapshot([]);
  });
  await cache.read();
  failed = true;
  await assert.rejects(cache.read(true));
  assert.equal(cache.peek(), undefined);
  failed = false;
  assert.deepEqual((await cache.read()).items, []);
});
