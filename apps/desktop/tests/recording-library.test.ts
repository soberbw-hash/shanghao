import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decodeRecordingMediaUrl,
  isAllowedRecordingPathInDirectory,
  readRecordingLibraryFromDirectory,
  toRecordingMediaUrl,
} from "../src/main/recording-library-core";

test("recording library lists old and room-aware recordings with marker points", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recordings-"));
  try {
    const legacyPath = path.join(directory, "上号-2026-08-12-10-20-30.m4a");
    const roomPath = path.join(directory, "上号-一号房-2026-08-12-10-21-30.m4a");
    await writeFile(legacyPath, Buffer.from([0, 1, 2]));
    await writeFile(roomPath, Buffer.from([3, 4, 5, 6]));
    await writeFile(
      path.join(directory, "上号-一号房-2026-08-12-10-21-30-精彩时刻.txt"),
      "1. 00:00:12\r\n2. 00:01:05\r\n",
      "utf8",
    );

    const library = await readRecordingLibraryFromDirectory(directory, 5);
    assert.equal(library.items.length, 2);
    const roomRecording = library.items.find((item) => item.filePath === roomPath);
    assert.equal(roomRecording?.roomId, "main");
    assert.deepEqual(
      roomRecording?.markers.map((marker) => marker.offsetMs),
      [12_000, 65_000],
    );
    const legacyRecording = library.items.find((item) => item.filePath === legacyPath);
    assert.equal(legacyRecording?.roomId, undefined);
    assert.equal(library.totalBytes, 7);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recording media URLs round-trip and directory traversal is rejected", () => {
  const directory = path.join(os.tmpdir(), "shanghao-library");
  const filePath = path.join(directory, "上号-二号房-test.m4a");
  const mediaUrl = toRecordingMediaUrl(filePath);
  assert.equal(decodeRecordingMediaUrl(mediaUrl), filePath);
  assert.equal(isAllowedRecordingPathInDirectory(directory, filePath), true);
  assert.equal(
    isAllowedRecordingPathInDirectory(directory, path.join(directory, "..", "outside.m4a")),
    false,
  );
  assert.equal(
    isAllowedRecordingPathInDirectory(directory, path.join(directory, "note.txt")),
    false,
  );
});
