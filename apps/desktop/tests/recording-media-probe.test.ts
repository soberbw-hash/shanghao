import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveFfmpegExecutable } from "../src/main/media-runtime";
import { parseRecordingMediaProbe, probeRecordingMedia } from "../src/main/recording-media-probe";

test("FFmpeg metadata parsing preserves duration and audio format", () => {
  assert.deepEqual(
    parseRecordingMediaProbe(
      "Duration: 01:02:03.450, start: 0.000000, bitrate: 192 kb/s\nStream #0:0: Audio: aac (LC), 48000 Hz, stereo",
    ),
    { durationMs: 3_723_450, inputFormat: "aac (LC), 48000 Hz, stereo" },
  );
  assert.equal(parseRecordingMediaProbe("Duration: N/A\nStream #0:0: Audio: pcm_s16le"), undefined);
});

test("bounded FFmpeg probe reads a generated WAV without touching user recordings", async (t) => {
  if (!resolveFfmpegExecutable()) return t.skip("FFmpeg is not available in this workspace");
  const directory = await mkdtemp(path.join(tmpdir(), "shanghao-probe-test-"));
  const filePath = path.join(directory, "tone.wav");
  try {
    const pcmBytes = 16_000 * 2;
    const wav = Buffer.alloc(44 + pcmBytes);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16_000, 24);
    wav.writeUInt32LE(32_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(pcmBytes, 40);
    await writeFile(filePath, wav);
    const probe = await probeRecordingMedia(filePath);
    assert.equal(probe.durationMs, 1000);
    assert.match(probe.inputFormat ?? "", /pcm_s16le/i);
    const invalidPath = path.join(directory, "invalid.txt");
    await writeFile(invalidPath, "private test content");
    await assert.rejects(probeRecordingMedia(invalidPath), (error: Error) => {
      assert.equal(error.message, "recording_duration_unavailable");
      assert.equal(error.message.includes("private test content"), false);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a cancelled transcription stops its active metadata probe", async (t) => {
  if (!resolveFfmpegExecutable()) return t.skip("FFmpeg is not available in this workspace");
  const controller = new AbortController();
  let started: (() => void) | undefined;
  const processStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const probe = probeRecordingMedia("unused-test-input.wav", {
    signal: controller.signal,
    startProcess: () => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        windowsHide: true,
      });
      started?.();
      return child;
    },
  });
  await processStarted;
  controller.abort();
  await assert.rejects(probe, /ai_task_paused/);
});

test("a previously cancelled metadata probe does not start FFmpeg", async () => {
  const controller = new AbortController();
  controller.abort();
  let started = false;
  await assert.rejects(
    probeRecordingMedia("unused-test-input.wav", {
      signal: controller.signal,
      startProcess: () => {
        started = true;
        throw new Error("must not start");
      },
    }),
    /ai_task_paused/,
  );
  assert.equal(started, false);
});
