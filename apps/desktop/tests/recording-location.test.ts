import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveRecordingPathForLocation } from "../src/main/recording-location";

test("recording location resolves an existing recording without a library rescan", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-location-"));
  try {
    const filePath = path.join(directory, "voice.m4a");
    await writeFile(filePath, Buffer.from([1, 2, 3]));

    assert.equal(await resolveRecordingPathForLocation(directory, filePath), filePath);
    assert.equal(
      await resolveRecordingPathForLocation(directory, filePath.replaceAll("\\", "/")),
      path.normalize(filePath.replaceAll("\\", "/")),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recording location rejects missing or outside files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-location-"));
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-outside-"));
  try {
    await assert.rejects(
      resolveRecordingPathForLocation(directory, path.join(directory, "missing.m4a")),
      /recording_not_found/,
    );
    await assert.rejects(
      resolveRecordingPathForLocation(directory, path.join(outsideDirectory, "outside.m4a")),
      /invalid_recording_path/,
    );
  } finally {
    await Promise.all([
      rm(directory, { recursive: true, force: true }),
      rm(outsideDirectory, { recursive: true, force: true }),
    ]);
  }
});
