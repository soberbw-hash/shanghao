import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { transcribeRemoteWithEmptyRecovery } from "../src/main/remote-transcription-empty";
import { parseVibeVoiceOutput } from "../src/main/asr-transcript-parser";

async function wavFixture(audible: boolean) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-empty-recovery-"));
  const file = path.join(directory, "sample.wav");
  const wav = Buffer.alloc(44 + 60000 * 32);
  wav.write("RIFF", 0);
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
  if (audible)
    for (let i = 44; i < wav.length; i += 2)
      wav.writeInt16LE(Math.round(Math.sin(i / 20) * 3000), i);
  await writeFile(file, wav);
  return { file, directory };
}

test("an empty long reply is rechecked as short audible windows with correct offsets", async () => {
  const f = await wavFixture(true);
  let calls = 0;
  try {
    const result = await transcribeRemoteWithEmptyRecovery(
      f.file,
      60000,
      new AbortController().signal,
      async (_file, duration) => {
        calls++;
        assert.equal(duration, calls === 1 ? 60000 : 30000);
        return { text: calls === 1 ? "" : `这是第${calls}段恢复的语音。`, modelName: "test-cloud" };
      },
      async () => {},
    );
    const transcript = parseVibeVoiceOutput(result.text, "recovery", 300000, 60000);
    assert.equal(calls, 3);
    assert.equal(result.emptyRechecked, true);
    assert.deepEqual(
      transcript.map((segment) => segment.startMs),
      [300000, 330000],
    );
    assert.equal(transcript.at(-1)?.endMs, 360000);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("silent short windows never cause repeated cloud uploads or fabricated text", async () => {
  const f = await wavFixture(false);
  let calls = 0;
  try {
    const result = await transcribeRemoteWithEmptyRecovery(
      f.file,
      60000,
      new AbortController().signal,
      async () => {
        calls++;
        return { text: "", modelName: "test-cloud" };
      },
      async () => {},
    );
    assert.equal(calls, 1);
    assert.equal(result.text, "");
    assert.equal(result.emptyRechecked, true);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
