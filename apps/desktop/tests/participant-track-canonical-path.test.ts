import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRemoteTranscriptionSources } from "../src/main/remote-transcription-sources";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";

test("AppData aliases resolve owned audio while recording-directory escapes remain rejected", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-track-alias-"));
  const physical = path.join(directory, "physical"),
    alias = path.join(directory, "roaming");
  const root = path.join(physical, "shanghao-desktop", "participant-tracks");
  const owned = path.join(root, "recordings", "synthetic");
  const previous = process.env.APPDATA;
  try {
    await mkdir(owned, { recursive: true });
    await symlink(physical, alias, process.platform === "win32" ? "junction" : "dir");
    process.env.APPDATA = alias;
    const lexical = path.join(
      alias,
      "shanghao-desktop",
      "participant-tracks",
      "recordings",
      "synthetic",
      "track.webm",
    );
    await writeFile(path.join(owned, "track.webm"), "synthetic-only");
    const manifest = {
      schemaVersion: 1,
      sessionId: "synthetic",
      recordingId: "synthetic",
      tracks: [
        {
          filePath: lexical,
          userId: "member",
          speakerId: "member",
          displayNameSnapshot: "合成成员",
          trackId: "track",
          roomId: "room-a",
          startMs: 0,
          endMs: 1000,
        },
      ],
    };
    await writeFile(path.join(owned, "manifest.json"), JSON.stringify(manifest));
    const record = createEmptyVoiceMemoryRecord({
      recordingId: "synthetic",
      filePath: path.join(directory, "unused.wav"),
      roomId: "room-a",
    });
    const load = () => loadRemoteTranscriptionSources(record, 1000, new AbortController().signal);
    const result = await load();
    assert.equal(result?.length, 1);
    assert.equal(result?.[0]?.filePath.toLowerCase(), (await realpath(lexical)).toLowerCase());
    const outside = path.join(directory, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "track.webm"), "must-not-upload");
    await writeFile(path.join(outside, "manifest.json"), JSON.stringify(manifest));
    await rm(owned, { recursive: true, force: true });
    await symlink(outside, owned, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(load(), /participant_track_path_invalid/);
  } finally {
    if (previous === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
