import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rename as moveFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  decodeRecordingMediaUrl,
  createRecordingMediaResponse,
  deleteRecordingInDirectory,
  isAllowedRecordingPathInDirectory,
  markerPathFor,
  parseRecordingRange,
  readRecordingLibraryFromDirectory,
  recycleUnprotectedRecordingInDirectory,
  RECORDING_LIBRARY_METADATA_FILE,
  recordingQuotaDeletionOrder,
  renameRecordingInDirectory,
  setRecordingFavoriteInDirectory,
  toRecordingMediaUrl,
} from "../src/main/recording-library-core";
import {
  isAutomaticWasteCandidate,
  parseRecordingProbeOutput,
  SHORT_RECORDING_MS,
  SILENT_RECORDING_PEAK_DB,
} from "../src/main/recording-cleanup";

test("recording cleanup marks recordings below ten minutes, silent media, or unreadable media", () => {
  assert.equal(SHORT_RECORDING_MS, 600_000);
  assert.equal(SILENT_RECORDING_PEAK_DB, -60);
  assert.equal(
    parseRecordingProbeOutput("Duration: 00:00:08.40, start: 0.000000\nmax_volume: -12.0 dB", 0)
      .reason,
    "too_short",
  );
  assert.equal(
    parseRecordingProbeOutput("Duration: 00:16:16.06, start: 0.000000\nmax_volume: -80.8 dB", 0)
      .reason,
    "silent",
  );
  assert.equal(
    parseRecordingProbeOutput("Duration: 00:09:59.99, start: 0.000000\nmax_volume: -8.0 dB", 0)
      .reason,
    "too_short",
  );
  assert.equal(
    parseRecordingProbeOutput("Duration: 00:10:00.00, start: 0.000000\nmax_volume: -8.0 dB", 0)
      .reason,
    undefined,
  );
  assert.equal(parseRecordingProbeOutput("invalid media", 1).reason, "unreadable");
});

test("automatic cleanup leaves unreadable recordings for manual review", () => {
  assert.equal(
    isAutomaticWasteCandidate({ filePath: "recording.m4a", reason: "unreadable" }),
    false,
  );
  assert.equal(isAutomaticWasteCandidate({ filePath: "recording.m4a", reason: "too_short" }), true);
  assert.equal(isAutomaticWasteCandidate({ filePath: "recording.m4a", reason: "silent" }), true);
});

test("sub-ten-minute recordings are waste while ten minutes and longer need silence to qualify", () => {
  for (const duration of ["00:00:10.00", "00:01:00.00", "00:05:00.00", "00:09:59.99"]) {
    const result = parseRecordingProbeOutput(
      `Duration: ${duration}, start: 0\nmax_volume: -25.0 dB`,
      0,
    );
    assert.equal(result.reason, "too_short");
    assert.equal(isAutomaticWasteCandidate({ filePath: "short.m4a", reason: result.reason }), true);
  }
  for (const duration of ["00:10:00.00", "00:10:00.01", "01:00:00.00"]) {
    assert.equal(
      parseRecordingProbeOutput(`Duration: ${duration}, start: 0\nmax_volume: -25.0 dB`, 0).reason,
      undefined,
    );
  }
  assert.equal(
    parseRecordingProbeOutput("Duration: 00:10:00.00, start: 0\nmax_volume: -inf dB", 0).reason,
    "silent",
  );
  assert.equal(
    parseRecordingProbeOutput("Duration: 01:00:00.00, start: 0\nmax_volume: -inf dB", 0).reason,
    "silent",
  );
});

test("manual waste recycling rechecks file identity, favorites and markers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-waste-guard-"));
  const filePath = path.join(directory, "recording.m4a");
  let moved = 0;
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    const before = (await readRecordingLibraryFromDirectory(directory, 1)).items[0]!;
    const recycle = async () => {
      moved++;
    };
    await setRecordingFavoriteInDirectory(directory, filePath, true);
    await assert.rejects(
      recycleUnprotectedRecordingInDirectory(directory, filePath, recycle, before),
      /recording_protected/,
    );
    await setRecordingFavoriteInDirectory(directory, filePath, false);
    await writeFile(markerPathFor(filePath), "1. 00:00:01\n");
    await assert.rejects(
      recycleUnprotectedRecordingInDirectory(directory, filePath, recycle, before),
      /recording_protected/,
    );
    await rm(markerPathFor(filePath));
    await writeFile(filePath, Buffer.from([1, 2, 3, 4]));
    await assert.rejects(
      recycleUnprotectedRecordingInDirectory(directory, filePath, recycle, before),
      /recording_changed_since_scan/,
    );
    assert.equal(moved, 0);
    assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3, 4]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual recycle recovery preserves recording identity and custom title", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-waste-restore-"));
  try {
    const filePath = path.join(directory, "recording.m4a");
    const trash = path.join(directory, "recycled.bin");
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    const first = (await readRecordingLibraryFromDirectory(directory, 1)).items[0]!;
    const before = await renameRecordingInDirectory(directory, first.recordingId, "我的误录");
    await recycleUnprotectedRecordingInDirectory(
      directory,
      before.filePath,
      (target) => moveFile(target, trash),
      before,
    );
    assert.equal((await readRecordingLibraryFromDirectory(directory, 1)).items.length, 0);
    await moveFile(trash, before.filePath);
    const restored = (await readRecordingLibraryFromDirectory(directory, 1)).items[0]!;
    assert.equal(restored.recordingId, before.recordingId);
    assert.equal(restored.title, "我的误录");
    assert.equal(restored.isCustomTitle, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recording library lists old and room-aware recordings with marker points", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recordings-"));
  try {
    const legacyPath = path.join(directory, "上号-2026-08-12-10-20-30.m4a");
    const roomPath = path.join(directory, "上号-一号房-2026-08-12-10-21-30.m4a");
    await writeFile(legacyPath, Buffer.from([0, 1, 2]));
    await writeFile(roomPath, Buffer.from([3, 4, 5, 6]));
    await writeFile(
      path.join(directory, "上号-一号房-2026-08-12-10-21-30-精彩时刻.txt"),
      "1. 00:00:12 · 12:26 启动了英雄联盟\r\n2. 00:01:05\r\n",
      "utf8",
    );

    const library = await readRecordingLibraryFromDirectory(directory, 5);
    assert.equal(library.items.length, 2);
    const roomRecording = library.items.find((item) => item.filePath === roomPath);
    assert.equal(roomRecording?.roomId, "main");
    assert.equal(roomRecording?.markers[0]?.label, "12:26 启动了英雄联盟");
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

test("invalid recording metadata is preserved and blocks automatic catalog reconstruction", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-corrupt-index-"));
  const filePath = path.join(directory, "recording.m4a");
  const metadataPath = path.join(directory, RECORDING_LIBRARY_METADATA_FILE);
  const markerPath = markerPathFor(filePath);
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    await writeFile(markerPath, "1. 00:00:01\n", "utf8");
    for (const content of ["{broken", '{"version":99,"favorites":[]}']) {
      await writeFile(metadataPath, content, "utf8");
      await assert.rejects(readRecordingLibraryFromDirectory(directory, 1), {
        message: "recording_library_metadata_invalid",
      });
      await assert.rejects(setRecordingFavoriteInDirectory(directory, filePath, true), {
        message: "recording_library_metadata_invalid",
      });
      await assert.rejects(deleteRecordingInDirectory(directory, filePath), {
        message: "recording_library_metadata_invalid",
      });
      assert.equal(await readFile(metadataPath, "utf8"), content);
      assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3]));
      assert.equal(await readFile(markerPath, "utf8"), "1. 00:00:01\n");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unreadable marker metadata is never treated as an unmarked recording", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-marker-error-"));
  const filePath = path.join(directory, "recording.m4a");
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    const recordingId = (await readRecordingLibraryFromDirectory(directory, 1)).items[0]!
      .recordingId;
    await mkdir(markerPathFor(filePath));
    await assert.rejects(readRecordingLibraryFromDirectory(directory, 1));
    await assert.rejects(renameRecordingInDirectory(directory, recordingId, "renamed"));
    assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a nonempty marker file with unknown content is not eligible for quota cleanup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-marker-format-"));
  const filePath = path.join(directory, "recording.m4a");
  const markerPath = markerPathFor(filePath);
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    await writeFile(markerPath, "unknown marker format", "utf8");
    await assert.rejects(readRecordingLibraryFromDirectory(directory, 1), {
      message: "recording_marker_unreadable",
    });
    assert.equal(await readFile(markerPath, "utf8"), "unknown marker format");
    assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3]));
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

test("recording metadata mutations are serialized so simultaneous favorites are not lost", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-metadata-queue-"));
  try {
    const firstPath = path.join(directory, "first.m4a");
    const secondPath = path.join(directory, "second.m4a");
    await writeFile(firstPath, Buffer.from([1]));
    await writeFile(secondPath, Buffer.from([2]));
    await readRecordingLibraryFromDirectory(directory, 10);

    await Promise.all([
      setRecordingFavoriteInDirectory(directory, firstPath, true),
      setRecordingFavoriteInDirectory(directory, secondPath, true),
    ]);

    const items = (await readRecordingLibraryFromDirectory(directory, 10)).items;
    assert.equal(items.find((item) => item.filePath === firstPath)?.isFavorite, true);
    assert.equal(items.find((item) => item.filePath === secondPath)?.isFavorite, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("catalog discovery and a concurrent favorite cannot overwrite each other", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-catalog-race-"));
  const filePath = path.join(directory, "new-recording.m4a");
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    const [first] = await Promise.all([
      readRecordingLibraryFromDirectory(directory, 1),
      setRecordingFavoriteInDirectory(directory, filePath, true),
    ]);
    const second = await readRecordingLibraryFromDirectory(directory, 1);
    assert.equal(second.items[0]?.recordingId, first.items[0]?.recordingId);
    assert.equal(second.items[0]?.isFavorite, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("automatic recycling rechecks a newly added favorite before touching audio", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-recycle-race-"));
  const filePath = path.join(directory, "recording.m4a");
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    await readRecordingLibraryFromDirectory(directory, 1);
    let recycled = false;
    const favorite = setRecordingFavoriteInDirectory(directory, filePath, true);
    const recycle = recycleUnprotectedRecordingInDirectory(directory, filePath, async () => {
      recycled = true;
    });
    await favorite;
    await assert.rejects(recycle, { message: "recording_protected" });
    assert.equal(recycled, false);
    assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("automatic recycling rechecks marker files and refuses unreadable marker content", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-recycle-marked-"));
  const filePath = path.join(directory, "recording.m4a");
  try {
    await writeFile(filePath, Buffer.from([1, 2, 3]));
    const recycle = () =>
      recycleUnprotectedRecordingInDirectory(directory, filePath, async () => {
        throw new Error("recycle_must_not_run");
      });
    await writeFile(markerPathFor(filePath), "1. 00:00:01\n", "utf8");
    await assert.rejects(recycle(), { message: "recording_protected" });
    await writeFile(markerPathFor(filePath), "unrecognized marker", "utf8");
    await assert.rejects(recycle(), { message: "recording_marker_unreadable" });
    assert.deepEqual(await readFile(filePath), Buffer.from([1, 2, 3]));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recording quota considers only unprotected recordings in oldest-first order", () => {
  const baseItem = {
    id: "newest",
    recordingId: "newest",
    title: "newest",
    fileName: "newest.m4a",
    filePath: "C:\\recordings\\newest.m4a",
    mediaUrl: "recording://newest",
    createdAt: "2026-08-13T10:22:30.000Z",
    modifiedAt: "2026-08-13T10:22:30.000Z",
    fileSize: 1,
    isFavorite: false,
    markers: [],
  };
  const candidates = recordingQuotaDeletionOrder([
    baseItem,
    {
      ...baseItem,
      id: "favorite",
      recordingId: "favorite",
      filePath: "C:\\recordings\\favorite.m4a",
      isFavorite: true,
    },
    {
      ...baseItem,
      id: "marked",
      recordingId: "marked",
      filePath: "C:\\recordings\\marked.m4a",
      markers: [{ id: "m1", offsetMs: 5_000, createdAt: "2026-08-13T10:22:35.000Z" }],
    },
    {
      ...baseItem,
      id: "oldest",
      recordingId: "oldest",
      filePath: "C:\\recordings\\oldest.m4a",
    },
  ]);

  assert.deepEqual(
    candidates.map((item) => item.recordingId),
    ["oldest", "newest"],
  );
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

test("recording identity, created time, favorite, and marker survive transactional rename", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-rename-"));
  try {
    const sourcePath = path.join(directory, "上号-一号房-2026-08-13-10-20-30.m4a");
    await writeFile(sourcePath, Buffer.from([1, 2, 3]));
    await writeFile(
      path.join(directory, "上号-一号房-2026-08-13-10-20-30-精彩时刻.txt"),
      "1. 00:00:05\r\n",
      "utf8",
    );
    await writeFile(path.join(directory, "会议.m4a"), Buffer.from([9]));
    await setRecordingFavoriteInDirectory(directory, sourcePath, true);
    const before = (await readRecordingLibraryFromDirectory(directory, 10)).items.find(
      (item) => item.filePath === sourcePath,
    );
    assert.ok(before);

    const renamed = await renameRecordingInDirectory(directory, before.recordingId, "会议.m4a");
    assert.equal(renamed.recordingId, before.recordingId);
    assert.equal(renamed.fileName, "会议 (2).m4a");
    assert.equal(renamed.title, "会议");
    assert.equal(renamed.createdAt, before.createdAt);
    assert.equal(renamed.isFavorite, true);
    assert.deepEqual(
      renamed.markers.map((marker) => marker.offsetMs),
      [5_000],
    );
    await assert.rejects(
      renameRecordingInDirectory(directory, before.recordingId, "bad:name"),
      /invalid_recording_title/,
    );
    assert.equal(
      (await readRecordingLibraryFromDirectory(directory, 10)).items.some(
        (item) => item.recordingId === before.recordingId && item.fileName === "会议 (2).m4a",
      ),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
