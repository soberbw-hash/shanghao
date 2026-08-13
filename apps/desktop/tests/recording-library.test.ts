import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decodeRecordingMediaUrl,
  createRecordingMediaResponse,
  isAllowedRecordingPathInDirectory,
  parseRecordingRange,
  readRecordingLibraryFromDirectory,
  setRecordingFavoriteInDirectory,
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

test("recording media responses support complete and partial M4A byte ranges", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-range-"));
  try {
    const filePath = path.join(directory, "range.m4a");
    await writeFile(filePath, Buffer.from(Array.from({ length: 32 }, (_, index) => index)));
    assert.deepEqual(parseRecordingRange("bytes=4-11", 32), { start: 4, end: 11 });
    assert.deepEqual(parseRecordingRange("bytes=-5", 32), { start: 27, end: 31 });
    assert.equal(parseRecordingRange("bytes=99-100", 32), "unsatisfiable");

    const partial = await createRecordingMediaResponse(filePath, "bytes=4-11");
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-type"), "audio/mp4");
    assert.equal(partial.headers.get("accept-ranges"), "bytes");
    assert.equal(partial.headers.get("content-range"), "bytes 4-11/32");
    assert.equal(partial.headers.get("content-length"), "8");
    assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())], [4, 5, 6, 7, 8, 9, 10, 11]);

    const invalid = await createRecordingMediaResponse(filePath, "bytes=99-100");
    assert.equal(invalid.status, 416);
    assert.equal(invalid.headers.get("content-range"), "bytes */32");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recording favorites persist locally without changing the audio file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-favorite-"));
  try {
    const firstPath = path.join(directory, "上号-一号房-2026-08-13-10-20-30.m4a");
    const secondPath = path.join(directory, "上号-二号房-2026-08-13-10-21-30.m4a");
    const audioBytes = Buffer.from([3, 1, 4, 1, 5]);
    await writeFile(firstPath, audioBytes);
    await writeFile(secondPath, Buffer.from([9, 2, 6]));

    await setRecordingFavoriteInDirectory(directory, firstPath, true);
    let library = await readRecordingLibraryFromDirectory(directory, 10);
    assert.equal(library.items.find((item) => item.filePath === firstPath)?.isFavorite, true);
    assert.equal(library.items.find((item) => item.filePath === secondPath)?.isFavorite, false);
    assert.deepEqual(await readFile(firstPath), audioBytes);

    await setRecordingFavoriteInDirectory(directory, firstPath, false);
    library = await readRecordingLibraryFromDirectory(directory, 10);
    assert.equal(library.items.find((item) => item.filePath === firstPath)?.isFavorite, false);
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
