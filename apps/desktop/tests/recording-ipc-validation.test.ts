import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  requireRecordingFileInDirectory,
  requireRecordingMarkerOffsets,
} from "../src/main/recording-ipc-validation";

test("recording IPC accepts only an existing audio file inside its selected library", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-ipc-"));
  const directory = path.join(root, "recordings");
  const inside = path.join(directory, "voice.m4a");
  const outside = path.join(root, "outside.m4a");
  try {
    await mkdir(directory);
    await writeFile(inside, "audio");
    await writeFile(outside, "audio");
    await writeFile(path.join(directory, "note.txt"), "note");
    assert.equal(await requireRecordingFileInDirectory(directory, inside), inside);
    await assert.rejects(
      requireRecordingFileInDirectory(directory, outside),
      /invalid_recording_file_path/,
    );
    await assert.rejects(
      requireRecordingFileInDirectory(directory, path.join(directory, "missing.m4a")),
    );
    await assert.rejects(
      requireRecordingFileInDirectory(directory, path.join(directory, "note.txt")),
      /invalid_recording_file_path/,
    );
    await assert.rejects(
      requireRecordingFileInDirectory(directory, null),
      /invalid_recording_file_path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recording IPC bounds marker count and offsets before writing a marker file", () => {
  assert.deepEqual(
    requireRecordingMarkerOffsets([{ offsetMs: 0 }, { offsetMs: 3_600_000 }]),
    [0, 3_600_000],
  );
  assert.throws(
    () => requireRecordingMarkerOffsets([{ offsetMs: -1 }]),
    /invalid_recording_markers/,
  );
  assert.throws(
    () => requireRecordingMarkerOffsets([{ offsetMs: Number.POSITIVE_INFINITY }]),
    /invalid_recording_markers/,
  );
  assert.throws(
    () => requireRecordingMarkerOffsets(new Array(2_001).fill({ offsetMs: 0 })),
    /invalid_recording_markers/,
  );
  assert.throws(() => requireRecordingMarkerOffsets(null), /invalid_recording_markers/);
});
