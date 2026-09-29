import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  readRecordingLibraryFromDirectory,
  RECORDING_LIBRARY_METADATA_FILE,
} from "../src/main/recording-library-core";

test("a large isolated recording library remains stable across repeated reads", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-scale-"));
  const count = 1_200;
  try {
    for (let start = 0; start < count; start += 100) {
      await Promise.all(
        Array.from({ length: Math.min(100, count - start) }, (_, offset) =>
          writeFile(path.join(directory, `recording-${start + offset}.m4a`), Buffer.from([1])),
        ),
      );
    }
    const firstStarted = performance.now();
    const first = await readRecordingLibraryFromDirectory(directory, 5);
    const firstMs = performance.now() - firstStarted;
    const secondStarted = performance.now();
    const second = await readRecordingLibraryFromDirectory(directory, 5);
    const secondMs = performance.now() - secondStarted;

    assert.equal(first.items.length, count);
    assert.equal(second.items.length, count);
    assert.equal(first.totalBytes, count);
    assert.deepEqual(
      new Map(first.items.map((item) => [item.fileName, item.recordingId])),
      new Map(second.items.map((item) => [item.fileName, item.recordingId])),
    );
    const metadataPath = path.join(directory, RECORDING_LIBRARY_METADATA_FILE);
    const before = await stat(metadataPath);
    for (let iteration = 0; iteration < 20; iteration += 1) {
      assert.equal((await readRecordingLibraryFromDirectory(directory, 5)).items.length, count);
    }
    const after = await stat(metadataPath);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal((await readdir(directory)).length, count + 1);
    assert.equal((await readdir(directory)).filter((name) => name.endsWith(".tmp")).length, 0);
    context.diagnostic(
      `recordings=${count} firstReadMs=${firstMs.toFixed(1)} secondReadMs=${secondMs.toFixed(1)}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
