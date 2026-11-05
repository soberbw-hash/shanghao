import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeRecordingSpeakerSegments,
  loadRecordingSpeakerSegments,
  saveRecordingSpeakerSegment,
} from "../src/main/recording-speaker-segments";
import {
  finalizeRecordingParticipantTracks,
  loadRecordingGameTimeline,
  loadRecordingParticipantTracks,
  saveRecordingParticipantTrack,
} from "../src/main/recording-participant-tracks";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { prepareGameAsrContext } from "../src/main/voice-memory-game-asr";
import { prepareKnownSpeakerSources } from "../src/main/voice-memory-transcription-preparation";

test("transcription refuses missing or redirected member audio without changing retained files", async () => {
  const isolated = await mkdtemp(path.join(os.tmpdir(), "shanghao-sidecar-coverage-"));
  const previous = process.env.APPDATA;
  process.env.APPDATA = isolated;
  try {
    const recordingId = "coverage-check";
    const recordingFilePath = path.join(isolated, "recording.m4a");
    const shared = {
      sessionId: "session",
      buffer: Uint8Array.from([1, 2]).buffer,
      sourceMimeType: "audio/webm",
      speakerId: "speaker",
      displayNameSnapshot: "Speaker",
      roomId: "room-a",
      startMs: 0,
      endMs: 1000,
    };
    const speaker = await saveRecordingSpeakerSegment({ ...shared, userId: "user" });
    const track = await saveRecordingParticipantTrack({
      ...shared,
      userId: "user",
      trackId: "track",
      roomId: "room-a",
    });
    assert.ok(speaker.ok && speaker.filePath && track.ok && track.filePath);
    await finalizeRecordingSpeakerSegments({
      sessionId: "session",
      recordingId,
      recordingFilePath,
    });
    await finalizeRecordingParticipantTracks({
      sessionId: "session",
      recordingId,
      recordingFilePath,
    });
    const speakerDirectory = path.join(
      isolated,
      "shanghao-desktop",
      "speaker-segments",
      "recordings",
      recordingId,
    );
    const trackDirectory = path.join(
      isolated,
      "shanghao-desktop",
      "participant-tracks",
      "recordings",
      recordingId,
    );
    const speakerAudio = path.join(speakerDirectory, path.basename(speaker.filePath));
    const trackAudio = path.join(trackDirectory, path.basename(track.filePath));
    assert.equal(
      (await loadRecordingSpeakerSegments(recordingId, recordingFilePath, true))?.length,
      1,
    );
    assert.equal(
      (await loadRecordingParticipantTracks(recordingId, recordingFilePath, true))?.length,
      1,
    );
    const record = createEmptyVoiceMemoryRecord({
      recordingId,
      filePath: recordingFilePath,
      roomId: "room-a",
    });
    const manifestPath = path.join(speakerDirectory, "manifest.json");
    const originalManifest = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(originalManifest);
    manifest.segments[0].roomId = "other-room";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      prepareKnownSpeakerSources(
        record,
        "qwen3-asr-0.6b-force",
        undefined,
        0,
        1000,
        new AbortController().signal,
      ),
      /speaker_segment_room_mismatch/,
    );
    manifest.segments[0].roomId = "room-a";
    manifest.segments[0].filePath = path.join(isolated, path.basename(speakerAudio));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      loadRecordingSpeakerSegments(recordingId, recordingFilePath, true),
      /speaker_segment_path_invalid/,
    );
    await writeFile(manifestPath, originalManifest);
    await rm(speakerAudio);
    await mkdir(speakerAudio);
    await assert.rejects(
      loadRecordingSpeakerSegments(recordingId, recordingFilePath, true),
      /speaker_segment_path_invalid/,
    );
    await rmdir(speakerAudio);
    await assert.rejects(
      prepareKnownSpeakerSources(
        record,
        "qwen3-asr-0.6b-force",
        undefined,
        0,
        1000,
        new AbortController().signal,
      ),
      /speaker_segment_audio_missing/,
    );
    assert.deepEqual(await readFile(trackAudio), Buffer.from([1, 2]));
    await writeFile(speakerAudio, Buffer.from([1, 2]));
    const trackManifestPath = path.join(trackDirectory, "manifest.json");
    const originalTrackManifest = await readFile(trackManifestPath, "utf8");
    const trackManifest = JSON.parse(originalTrackManifest);
    trackManifest.tracks[0].roomId = "other-room";
    await writeFile(trackManifestPath, JSON.stringify(trackManifest));
    await assert.rejects(
      prepareKnownSpeakerSources(
        record,
        "qwen3-asr-0.6b-force",
        undefined,
        0,
        1000,
        new AbortController().signal,
      ),
      /participant_track_room_mismatch/,
    );
    await writeFile(trackManifestPath, originalTrackManifest);
    await rm(trackAudio);
    await mkdir(trackAudio);
    await assert.rejects(
      loadRecordingParticipantTracks(recordingId, recordingFilePath, true),
      /participant_track_path_invalid/,
    );
    await rmdir(trackAudio);
    await assert.rejects(
      prepareKnownSpeakerSources(
        record,
        "qwen3-asr-0.6b-force",
        undefined,
        0,
        1000,
        new AbortController().signal,
      ),
      /participant_track_audio_missing/,
    );
    assert.deepEqual(await readFile(speakerAudio), Buffer.from([1, 2]));
  } finally {
    if (previous === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous;
    await rm(isolated, { recursive: true, force: true });
  }
});

test("game snapshots are bound to the recorded room and older manifests remain readable", async () => {
  const isolated = await mkdtemp(path.join(os.tmpdir(), "shanghao-game-sidecar-"));
  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = isolated;
  const timeline = {
    schemaVersion: 1 as const,
    roomId: "room-a",
    durationMs: 1000,
    complete: true,
    events: [{ offsetMs: 0, memberId: "user", present: true, gameName: "英雄联盟" }],
  };
  const save = async (sessionId: string, recordingId: string, gameTimeline?: typeof timeline) => {
    assert.equal(
      (
        await saveRecordingParticipantTrack({
          sessionId,
          buffer: Uint8Array.of(1, 2).buffer,
          sourceMimeType: "audio/webm",
          userId: "user",
          speakerId: "speaker",
          displayNameSnapshot: "Speaker",
          trackId: "track",
          roomId: "room-a",
          startMs: 0,
          endMs: 1000,
        })
      ).ok,
      true,
    );
    await finalizeRecordingParticipantTracks({
      sessionId,
      recordingId,
      recordingFilePath: path.join(isolated, `${recordingId}.m4a`),
      gameTimeline,
    });
  };
  try {
    await save("session-a", "record-a", timeline);
    assert.deepEqual(await loadRecordingGameTimeline("record-a"), timeline);
    const record = {
      ...createEmptyVoiceMemoryRecord({
        recordingId: "record-a",
        filePath: "a.wav",
        roomId: "room-a",
      }),
      localAsrAutoGameContext: true,
    };
    const source = {
      speakerId: "speaker",
      accountIdentity: "user",
      displayNameSnapshot: "Speaker",
      filePath: "track.webm",
      audioOffsetMs: 0,
      startMs: 0,
      endMs: 900,
    };
    const context = await prepareGameAsrContext(record, false, new AbortController().signal);
    assert.equal(context(source), "游戏：英雄联盟");
    assert.equal(context({ ...source, accountIdentity: "other" }), "");
    assert.equal(context(), "");
    const manual = await prepareGameAsrContext(
      { ...record, localAsrContext: { gameName: "CS2", terms: ["闪光"] } },
      false,
      new AbortController().signal,
    );
    assert.equal(manual(source), "游戏：CS2；相关词：闪光");
    const customTerms = await prepareGameAsrContext(
      { ...record, localAsrContext: { terms: ["闪现"] } },
      false,
      new AbortController().signal,
    );
    assert.equal(customTerms(source), "游戏：英雄联盟；相关词：闪现");
    assert.equal(customTerms({ ...source, accountIdentity: "other" }), "相关词：闪现");
    const benchmark = await prepareGameAsrContext(record, true, new AbortController().signal);
    assert.equal(benchmark(source), undefined);
    await save("session-old", "record-old");
    assert.equal(await loadRecordingGameTimeline("record-old"), undefined);
    await save("session-b", "record-b", { ...timeline, roomId: "other-room" });
    assert.equal(await loadRecordingGameTimeline("record-b"), undefined);
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previousAppData;
    await rm(isolated, { recursive: true, force: true });
  }
});

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
