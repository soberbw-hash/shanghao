import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile, utimes } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { inspectStorageDirectory } from "../src/main/storage-usage";
import { createAsrTemporaryWavPath, pruneStaleAsrTempFiles } from "../src/main/asr-temp-files";
import {
  saveRecordingOriginInDirectory,
  readRecordingLibraryFromDirectory,
} from "../src/main/recording-library-core";
import { finishSavedRoomRecording } from "../src/renderer/src/features/recording/finishSavedRoomRecording";
import type { DesktopApi } from "@private-voice/shared";

test("storage inspection counts only files and bounds incomplete scans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-storage-test-"));
  try {
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "one"), Buffer.alloc(123));
    await writeFile(path.join(root, "nested", "two"), Buffer.alloc(456));
    const result = await inspectStorageDirectory("models", root);
    assert.equal(result.bytes, 579);
    assert.equal(result.files, 2);
    assert.equal(result.complete, true);
    assert.equal(
      (await inspectStorageDirectory("models", root, { maxEntries: 1 })).complete,
      false,
    );
    assert.equal((await inspectStorageDirectory("models", path.join(root, "absent"))).bytes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expired ASR cache belonging to a live process is retained", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-live-temp-test-"));
  try {
    const file = createAsrTemporaryWavPath("active", 0, root);
    await writeFile(file, "active");
    const old = new Date(Date.now() - 8 * 86400000);
    await utimes(file, old, old);
    assert.equal((await pruneStaleAsrTempFiles(root)).removed, 0);
    assert.equal(await readFile(file, "utf8"), "active");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recording origin survives rename-like titles and cannot be rebound to another room", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-origin-test-"));
  const file = path.join(root, "上号-朋友的房间.m4a");
  const roomId = `room_${"a".repeat(32)}`;
  try {
    await writeFile(file, "fixture");
    await saveRecordingOriginInDirectory(root, file, roomId, "朋友的房间");
    const item = (await readRecordingLibraryFromDirectory(root, 20)).items[0]!;
    assert.equal(item.roomId, roomId);
    assert.equal(item.roomName, "朋友的房间");
    await assert.rejects(
      saveRecordingOriginInDirectory(root, file, `room_${"b".repeat(32)}`, "另一个房间"),
      /recording_origin_conflict/,
    );
    assert.equal((await readRecordingLibraryFromDirectory(root, 20)).items[0]?.roomId, roomId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("recording post-processing runs once and retries marker failure before cleanup", async () => {
  const events: string[] = [];
  let fail = true;
  const api = {
    recording: {
      saveOrigin: async () => {
        events.push("origin");
      },
      saveMarkers: async () => {
        events.push("markers");
        if (fail) throw new Error("marker_failed");
      },
      applyAutomaticCleanup: async () => {
        events.push("cleanup");
        return { deletedCurrentRecording: false };
      },
    },
  } as unknown as DesktopApi;
  const options = {
    result: { filePath: "fixture", recordingId: "record" },
    markers: [{ id: "m", offsetMs: 0, createdAt: "2026-09-30" }],
    roomId: `room_${"a".repeat(32)}`,
    roomName: "Origin",
    speakingTimeline: [],
    api,
    toast: () => events.push("toast"),
  };
  const first = finishSavedRoomRecording(options);
  assert.strictEqual(first, finishSavedRoomRecording(options));
  await assert.rejects(first, /marker_failed/);
  assert.deepEqual(events, ["origin", "markers"]);
  fail = false;
  await finishSavedRoomRecording(options);
  await finishSavedRoomRecording(options);
  assert.deepEqual(events, ["origin", "markers", "origin", "markers", "cleanup", "toast"]);
});
