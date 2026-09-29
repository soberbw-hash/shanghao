import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAsrTemporaryWavPath, pruneStaleAsrTempFiles } from "../src/main/asr-temp-files";

test("ASR temporary WAV names are unique for concurrent chunks", () => {
  const first = createAsrTemporaryWavPath("recording-a", 0, "C:\\temp");
  const second = createAsrTemporaryWavPath("recording-a", 0, "C:\\temp");
  assert.notEqual(first, second);
  assert.match(path.basename(first), /^[a-f0-9]{20}-0-\d+-[a-f0-9-]{36}\.wav$/u);
});

test("cleanup only removes old owned regular files and preserves recent or unrelated data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-prune-test-"));
  const now = Date.now();
  const old = path.join(directory, `${"a".repeat(20)}-0-1234.wav`);
  const oldUnique = createAsrTemporaryWavPath("older", 1000, directory);
  const recent = createAsrTemporaryWavPath("recent", 0, directory);
  const unrelated = path.join(directory, "my-recording.wav");
  try {
    await writeFile(old, "old temp");
    await writeFile(oldUnique, "old unique temp");
    await writeFile(recent, "active temp");
    await writeFile(unrelated, "user data");
    const oldTime = new Date(now - 8 * 24 * 60 * 60 * 1_000);
    await utimes(old, oldTime, oldTime);
    await utimes(oldUnique, oldTime, oldTime);
    await utimes(unrelated, oldTime, oldTime);

    const result = await pruneStaleAsrTempFiles(directory, now);
    assert.equal(result.removed, 2);
    assert.equal(result.removedBytes, 23);
    await assert.rejects(readFile(old), { code: "ENOENT" });
    await assert.rejects(readFile(oldUnique), { code: "ENOENT" });
    assert.equal(await readFile(recent, "utf8"), "active temp");
    assert.equal(await readFile(unrelated, "utf8"), "user data");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
