import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import {
  transcribeWithRemoteProvider,
  isTranscriptionExecutionComplete,
} from "../src/main/remote-transcription";
import {
  saveRecordingParticipantTrack,
  finalizeRecordingParticipantTracks,
  loadRecordingParticipantTracks,
} from "../src/main/recording-participant-tracks";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { isVoiceMemoryRecord } from "../src/main/voice-memory-store";

const wav = (value: number) => {
  const data = Buffer.alloc(32044);
  data.write("RIFF");
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(32000, 40);
  for (let offset = 44; offset < data.length; offset += 2) data.writeInt16LE(value, offset);
  return data;
};

test("cloud uses identified participant audio, preserves overlap and resumes each source independently", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-remote-speakers-"));
  const previous = process.env.APPDATA;
  process.env.APPDATA = directory;
  const filePath = path.join(directory, "mixed.wav");
  await writeFile(filePath, wav(99));
  let record = createEmptyVoiceMemoryRecord({
    recordingId: "participants",
    filePath,
    roomId: "room-a",
  });
  const calls: number[] = [];
  const savedRecords: VoiceMemoryRecord[] = [];
  try {
    for (const [userId, peer, name, value, startMs] of [
      ["account-a", "old-peer-a", "小王", 100, 0],
      ["account-b", "peer-b", "小李", 200, 0],
      ["account-a", "new-peer-a", "小王", 300, 700],
    ] as const) {
      const audio = wav(value);
      const response = await saveRecordingParticipantTrack({
        sessionId: "session",
        buffer: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
        sourceMimeType: "audio/webm",
        userId,
        speakerId: peer,
        displayNameSnapshot: name,
        trackId: peer,
        roomId: "room-a",
        startMs,
        endMs: 1000,
      });
      assert.equal(response.ok, true);
    }
    await finalizeRecordingParticipantTracks({
      sessionId: "session",
      recordingId: record.recordingId,
      recordingFilePath: filePath,
    });
    const run = () =>
      transcribeWithRemoteProvider({
        record,
        provider: "cloud",
        signal: new AbortController().signal,
        store: {
          status: async () => ({ cloudConfigured: true }),
          transcribe: async (file: string) => {
            assert.notEqual(
              file,
              filePath,
              "do not send the mixed recording when member tracks exist",
            );
            const audio = await readFile(file);
            calls.push(audio.readInt16LE(audio.indexOf(Buffer.from("data")) + 8));
            return { text: "我们先守住这条路。", modelName: "fixture-cloud" };
          },
        } as never,
        save: async (next) => {
          assert.equal(isVoiceMemoryRecord(next), true);
          record = next;
          savedRecords.push(next);
          return next;
        },
        updateDiagnostic: async (next, _request, _task, stage, status, patch) =>
          ({
            ...next,
            processingStage: stage,
            taskStatus: status,
            diagnostic: { ...next.diagnostic, ...patch },
          }) as VoiceMemoryRecord,
      });
    const result = await run();
    assert.deepEqual(
      [...calls].sort((left, right) => left - right),
      [100, 200, 300],
    );
    assert.deepEqual(
      result.speakers.map((speaker) => [speaker.speakerId, speaker.nickname]).sort(),
      [
        ["account-a", "小王"],
        ["account-b", "小李"],
      ],
    );
    assert.deepEqual(
      result.transcript.map((segment) => [segment.speakerId, segment.startMs]).sort(),
      [
        ["account-a", 0],
        ["account-a", 700],
        ["account-b", 0],
      ],
    );
    assert.equal(new Set(result.transcript.map((segment) => segment.id)).size, 3);
    assert.ok(result.transcript[0]!.endMs > result.transcript[1]!.startMs);
    assert.equal(result.remoteTranscription?.sources?.length, 3);
    assert.equal(isTranscriptionExecutionComplete(result), true);
    assert.equal(
      isTranscriptionExecutionComplete({
        ...result,
        remoteTranscription: {
          ...result.remoteTranscription!,
          parts: result.remoteTranscription!.parts.slice(1),
        },
      }),
      false,
    );
    assert.ok(
      savedRecords.some((saved) => saved.transcript.length === 1),
      "completed members appear before the whole task finishes",
    );
    const resumed = await run();
    assert.equal(
      calls.length,
      3,
      "cached replies must remain keyed by track identity, not start time alone",
    );
    assert.equal(resumed.transcript.length, 3);
    const manifestPath = path.join(
      directory,
      "shanghao-desktop/participant-tracks/recordings/participants/manifest.json",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const trusted = manifest.tracks[0].filePath;
    manifest.tracks[0].filePath = filePath;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(run(), /participant_track_path_invalid/);
    assert.equal(calls.length, 3, "a manifest cannot redirect the upload to another local file");
    manifest.tracks[0].filePath = trusted;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(trusted, wav(400));
    await run();
    assert.deepEqual(
      calls.slice(3).sort((left, right) => left - right),
      [200, 300, 400],
      "modified source audio invalidates the prior response cache",
    );
    const tracks = await loadRecordingParticipantTracks(record.recordingId, filePath);
    await rm(tracks![0]!.filePath);
    await assert.rejects(run(), /participant_track_audio_missing/);
    assert.equal(calls.length, 6, "an incomplete source manifest cannot silently drop a member");
  } finally {
    if (previous === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a different room's participant track is rejected before any cloud upload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-remote-speaker-room-"));
  const previous = process.env.APPDATA;
  process.env.APPDATA = directory;
  const filePath = path.join(directory, "mixed.wav");
  await writeFile(filePath, wav(1));
  try {
    const audio = wav(2);
    await saveRecordingParticipantTrack({
      sessionId: "session",
      buffer: audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength),
      sourceMimeType: "audio/webm",
      userId: "user",
      speakerId: "peer",
      displayNameSnapshot: "成员",
      trackId: "track",
      roomId: "other-room",
      startMs: 0,
      endMs: 1000,
    });
    await finalizeRecordingParticipantTracks({
      sessionId: "session",
      recordingId: "room-check",
      recordingFilePath: filePath,
    });
    await assert.rejects(
      transcribeWithRemoteProvider({
        record: createEmptyVoiceMemoryRecord({
          recordingId: "room-check",
          filePath,
          roomId: "room-a",
        }),
        provider: "cloud",
        signal: new AbortController().signal,
        store: {
          status: async () => ({ cloudConfigured: true, customConfigured: false }),
          transcribe: async () => assert.fail("must not upload"),
        } as never,
        save: async (record) => record,
        updateDiagnostic: async (record) => record,
      }),
      /participant_track_room_mismatch/,
    );
  } finally {
    if (previous === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
