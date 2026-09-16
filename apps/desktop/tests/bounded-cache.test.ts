import assert from "node:assert/strict";
import test from "node:test";

import { readLruCache, writeLruCache } from "../src/main/bounded-cache";

test("bounded cache evicts the least recently used entry", () => {
  const cache = new Map<string, number>();
  writeLruCache(cache, "a", 1, 2);
  writeLruCache(cache, "b", 2, 2);
  assert.equal(readLruCache(cache, "a"), 1);
  writeLruCache(cache, "c", 3, 2);

  assert.deepEqual(
    [...cache],
    [
      ["a", 1],
      ["c", 3],
    ],
  );
});

test("bounded cache also bounds cached misses", () => {
  const cache = new Map<string, string | null>();
  for (let index = 0; index < 20; index += 1) {
    writeLruCache(cache, String(index), null, 4);
  }
  assert.equal(cache.size, 4);
  assert.deepEqual([...cache.keys()], ["16", "17", "18", "19"]);
});
