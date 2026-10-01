import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { transcodeSavedRecording } from "../src/main/recording-transcode";
import { probeRecordingMedia } from "../src/main/recording-media-probe";
import { resolveFfmpegExecutable } from "../src/main/media-runtime";

test("ordinary FFmpeg recording export produces playable AAC and preserves its input", async (t) => {
  if (!resolveFfmpegExecutable()) return t.skip("FFmpeg unavailable");
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-export-test-"));
  try {
    const input = path.join(root, "fixture.wav");
    const output = path.join(root, "fixture.m4a");
    const wave = Buffer.alloc(44 + 16_000 * 2);
    wave.write("RIFF", 0);
    wave.writeUInt32LE(wave.length - 8, 4);
    wave.write("WAVEfmt ", 8);
    wave.writeUInt32LE(16, 16);
    wave.writeUInt16LE(1, 20);
    wave.writeUInt16LE(1, 22);
    wave.writeUInt32LE(16_000, 24);
    wave.writeUInt32LE(32_000, 28);
    wave.writeUInt16LE(2, 32);
    wave.writeUInt16LE(16, 34);
    wave.write("data", 36);
    wave.writeUInt32LE(wave.length - 44, 40);
    for (let i = 0; i < 16_000; i++)
      wave.writeInt16LE(Math.round(Math.sin((i * Math.PI * 440) / 8_000) * 1_000), 44 + i * 2);
    await writeFile(input, wave);
    await transcodeSavedRecording(input, output, 1);
    assert.ok((await stat(output)).size > 0);
    const media = await probeRecordingMedia(output);
    assert.ok(Math.abs(media.durationMs - 1_000) < 100);
    assert.match(media.inputFormat ?? "", /aac.*48000 Hz.*mono/iu);
    assert.deepEqual(await readFile(input), wave);
    await assert.rejects(
      transcodeSavedRecording(path.join(root, "missing.wav"), path.join(root, "failed.m4a"), 1),
    );
    assert.deepEqual(await readFile(input), wave);
  } finally {
    const resolved = await import("node:fs/promises").then((fs) => fs.realpath(root));
    assert.equal(path.dirname(resolved).toLowerCase(), path.resolve(tmpdir()).toLowerCase());
    assert.match(path.basename(resolved), /^shanghao-export-test-/u);
    await rm(root, { recursive: true, force: true });
  }
});
