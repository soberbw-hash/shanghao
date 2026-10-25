import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cloudSpeechWindows,
  transcribeCloudSpeechWindows,
} from "../src/main/remote-speech-windows";
import { parseVibeVoiceOutput } from "../src/main/asr-transcript-parser";

function pcm(ranges: Array<[number, number, number]>, duration = 30000) {
  const wav = Buffer.alloc(44 + duration * 32);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (const [start, end, value] of ranges)
    for (let i = start * 16; i < end * 16; i++) wav.writeInt16LE(value, 44 + i * 2);
  return wav;
}

test("cloud phrase times follow actual audible windows, not punctuation spread across silence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-speech-window-test-"));
  try {
    const file = path.join(directory, "synthetic.wav");
    await writeFile(
      file,
      pcm([
        [5000, 6000, 1000],
        [24000, 25000, 1000],
      ]),
    );
    const received: string[] = [];
    const result = await transcribeCloudSpeechWindows(
      file,
      new AbortController().signal,
      async (slice, duration) => {
        received.push(slice);
        assert.ok(duration < 2000);
        assert.ok((await readFile(slice)).length > 44);
        return { text: "我们先去下路。等打野过来。", modelName: "synthetic" };
      },
    );
    const rows = parseVibeVoiceOutput(result.text, "synthetic", 30000, 30000);
    assert.equal(rows.length, 2, "two audio phrases, not four invented sentence locations");
    assert.equal(rows[0]?.startMs, 34850);
    assert.equal(rows[1]?.startMs, 53850);
    for (const slice of received) await assert.rejects(readFile(slice), { code: "ENOENT" });
    await writeFile(file, pcm([]));
    await transcribeCloudSpeechWindows(file, new AbortController().signal, async () =>
      assert.fail("digital silence must not be uploaded"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("quiet nonzero audio is retained and long voiced windows remain bounded", () => {
  assert.deepEqual(cloudSpeechWindows(pcm([[0, 30000, 1]])), [{ startMs: 0, endMs: 30000 }]);
  const windows = cloudSpeechWindows(pcm([[0, 30000, 1000]]));
  assert.ok(windows.length >= 2);
  windows.forEach((window) => assert.ok(window.endMs - window.startMs <= 18000));
  assert.equal(windows[0]?.startMs, 0);
  assert.equal(windows.at(-1)?.endMs, 30000);
});
