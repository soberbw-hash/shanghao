import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { RecordingStreamFinalizePayload } from "@private-voice/shared";

test("repeated stream finalization saves one recording and returns the same result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-main-"));
  const require = createRequire(import.meta.url);
  require("electron");
  const electronModule = require.cache[require.resolve("electron")];
  assert.ok(electronModule);
  electronModule.exports = { app: { getPath: () => root } };
  try {
    const recording = await import("../src/main/recording-main");
    const started = await recording.startRecordingSession("audio/mp4");
    assert.equal(started.ok, true);
    assert.ok(started.sessionId);
    await recording.appendRecordingChunk(started.sessionId, Uint8Array.from([1, 2, 3]).buffer);
    const payload: RecordingStreamFinalizePayload = {
      sessionId: started.sessionId,
      sourceMimeType: "audio/mp4",
      sampleRate: 48000,
      suggestedFileName: "test.m4a",
      channels: 1,
      targetFormat: "m4a-aac",
      durationMs: 1000,
    };
    const directory = path.join(root, "library");
    const writeLog = async () => undefined;
    const firstSave = recording.finalizeRecordingSession(payload, directory, writeLog);
    const appendAfterFinalization = recording.appendRecordingChunk(
      started.sessionId,
      Uint8Array.from([4]).buffer,
    );
    const secondSave = recording.finalizeRecordingSession(payload, directory, writeLog);
    const abortDuringSave = recording.abortRecordingSession(started.sessionId);
    const sealDuringSave = recording.sealRecordingSession(started.sessionId);
    await assert.rejects(appendAfterFinalization, /recording_stream_finalizing/);
    const [first, second] = await Promise.all([firstSave, secondSave]);
    await Promise.all([abortDuringSave, sealDuringSave]);
    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.equal((await readdir(directory)).filter((file) => file.endsWith(".m4a")).length, 1);

    const ongoing = await recording.startRecordingSession("audio/mp4");
    assert.ok(ongoing.sessionId);
    for (let index = 0; index < 16; index += 1) {
      await recording.appendRecordingChunk(ongoing.sessionId, Uint8Array.from([index]).buffer);
    }
    const sessionDirectory = path.join(root, "shanghao-recordings", "stream-sessions");
    const metadata = JSON.parse(
      await readFile(path.join(sessionDirectory, `${ongoing.sessionId}.json`), "utf8"),
    ) as { bytesWritten: number; chunkCount: number };
    assert.equal(metadata.bytesWritten, 16);
    assert.equal(metadata.chunkCount, 16);
    assert.equal(
      (await readdir(sessionDirectory)).some((name) => name.endsWith(".tmp")),
      false,
    );
    await recording.sealRecordingSession(ongoing.sessionId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
