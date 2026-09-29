import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeRecordingSpeakerSegments,
  saveRecordingSpeakerSegment,
} from "../src/main/recording-speaker-segments";
import {
  finalizeRecordingParticipantTracks,
  saveRecordingParticipantTrack,
} from "../src/main/recording-participant-tracks";

test("damaged recording sidecar manifests cannot overwrite retained audio or be finalized", async () => {
  const isolatedAppData = await mkdtemp(path.join(os.tmpdir(), "shanghao-sidecar-corrupt-"));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = isolatedAppData;
  const userData = path.join(isolatedAppData, "shanghao-desktop");
  const cases = [
    {
      subdirectory: "speaker-segments",
      name: "000000-0-1000.webm",
      save: () =>
        saveRecordingSpeakerSegment({
          sessionId: "speaker-corrupt",
          buffer: Uint8Array.from([9, 9]).buffer,
          sourceMimeType: "audio/webm",
          speakerId: "speaker",
          displayNameSnapshot: "Speaker",
          startMs: 0,
          endMs: 1000,
        }),
      finalize: () =>
        finalizeRecordingSpeakerSegments({
          sessionId: "speaker-corrupt",
          recordingId: "speaker-recording",
          recordingFilePath: path.join(isolatedAppData, "recording.m4a"),
        }),
    },
    {
      subdirectory: "participant-tracks",
      name: "0000-user-0-1000.webm",
      save: () =>
        saveRecordingParticipantTrack({
          sessionId: "participant-corrupt",
          buffer: Uint8Array.from([9, 9]).buffer,
          sourceMimeType: "audio/webm",
          userId: "user",
          speakerId: "speaker",
          displayNameSnapshot: "Speaker",
          trackId: "track",
          roomId: "main",
          startMs: 0,
          endMs: 1000,
        }),
      finalize: () =>
        finalizeRecordingParticipantTracks({
          sessionId: "participant-corrupt",
          recordingId: "participant-recording",
          recordingFilePath: path.join(isolatedAppData, "recording.m4a"),
        }),
    },
  ];
  try {
    for (const item of cases) {
      const sessionId =
        item.subdirectory === "speaker-segments" ? "speaker-corrupt" : "participant-corrupt";
      const pending = path.join(userData, item.subdirectory, "pending", sessionId);
      const audio = path.join(pending, item.name);
      const manifest = path.join(pending, "manifest.json");
      await mkdir(pending, { recursive: true });
      await writeFile(audio, Buffer.from([1, 2, 3]));
      await writeFile(manifest, "{broken", "utf8");
      assert.equal((await item.save()).ok, false);
      await assert.rejects(item.finalize());
      assert.deepEqual(await readFile(audio), Buffer.from([1, 2, 3]));
      assert.equal(await readFile(manifest, "utf8"), "{broken");

      await rm(manifest);
      assert.match((await item.save()).errorMessage ?? "", /manifest_missing_with_audio/);
      assert.deepEqual(await readFile(audio), Buffer.from([1, 2, 3]));

      const manifestEntries = item.subdirectory === "speaker-segments" ? "segments" : "tracks";
      await writeFile(
        manifest,
        JSON.stringify({ schemaVersion: 1, sessionId, [manifestEntries]: [] }),
        "utf8",
      );
      assert.match((await item.save()).errorMessage ?? "", /unindexed_audio/);
      await assert.rejects(item.finalize(), /unindexed_audio/);
      assert.deepEqual(await readFile(audio), Buffer.from([1, 2, 3]));
    }
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    await rm(isolatedAppData, { recursive: true, force: true });
  }
});

test("finalizing sidecar audio never replaces a preexisting target segment", async () => {
  const isolatedAppData = await mkdtemp(path.join(os.tmpdir(), "shanghao-sidecar-target-"));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = isolatedAppData;
  const userData = path.join(isolatedAppData, "shanghao-desktop");
  const cases = [
    {
      subdirectory: "speaker-segments",
      sessionId: "speaker-target",
      recordingId: "speaker-target-recording",
      save: () =>
        saveRecordingSpeakerSegment({
          sessionId: "speaker-target",
          buffer: Uint8Array.from([9, 9]).buffer,
          sourceMimeType: "audio/webm",
          speakerId: "speaker",
          displayNameSnapshot: "Speaker",
          startMs: 0,
          endMs: 1000,
        }),
      finalize: () =>
        finalizeRecordingSpeakerSegments({
          sessionId: "speaker-target",
          recordingId: "speaker-target-recording",
          recordingFilePath: path.join(isolatedAppData, "recording.m4a"),
        }),
    },
    {
      subdirectory: "participant-tracks",
      sessionId: "participant-target",
      recordingId: "participant-target-recording",
      save: () =>
        saveRecordingParticipantTrack({
          sessionId: "participant-target",
          buffer: Uint8Array.from([9, 9]).buffer,
          sourceMimeType: "audio/webm",
          userId: "user",
          speakerId: "speaker",
          displayNameSnapshot: "Speaker",
          trackId: "track",
          roomId: "main",
          startMs: 0,
          endMs: 1000,
        }),
      finalize: () =>
        finalizeRecordingParticipantTracks({
          sessionId: "participant-target",
          recordingId: "participant-target-recording",
          recordingFilePath: path.join(isolatedAppData, "recording.m4a"),
        }),
    },
  ];
  try {
    for (const item of cases) {
      const saved = await item.save();
      assert.equal(saved.ok, true);
      const source = saved.filePath!;
      const targetDirectory = path.join(
        userData,
        item.subdirectory,
        "recordings",
        item.recordingId,
      );
      await mkdir(targetDirectory, { recursive: true });
      const target = path.join(targetDirectory, path.basename(source));
      await writeFile(target, Buffer.from([1, 2, 3]));
      await assert.rejects(item.finalize());
      assert.deepEqual(await readFile(target), Buffer.from([1, 2, 3]));
      assert.deepEqual(await readFile(source), Buffer.from([9, 9]));
      await rm(target);
      await item.finalize();
      assert.deepEqual(await readFile(target), Buffer.from([9, 9]));
      await assert.rejects(readFile(source), { code: "ENOENT" });
    }
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    await rm(isolatedAppData, { recursive: true, force: true });
  }
});
