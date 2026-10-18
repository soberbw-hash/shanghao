import assert from "node:assert/strict";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import {
  remoteTranscriptionRanges,
  transcribeRemoteParts,
} from "../src/main/remote-transcription-parts";

test("long recording ranges cover the entire recording without time gaps", () => {
  const duration = (3 * 3600 + 42 * 60 + 53) * 1000;
  const ranges = remoteTranscriptionRanges(duration);
  assert.equal(ranges[0]?.startMs, 0);
  assert.equal(
    ranges.reduce((sum, range) => sum + range.durationMs, 0),
    duration,
  );
  ranges.forEach((range, index) => {
    assert.ok(range.durationMs <= 15 * 60_000);
    if (index)
      assert.equal(range.startMs, ranges[index - 1]!.startMs + ranges[index - 1]!.durationMs);
  });
  assert.throws(() => remoteTranscriptionRanges(Number.NaN));
});

test("real encoder splits an over-hour recording below API limits and removes only its temporary parts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-long-asr-test-"));
  const file = path.join(directory, "silence.wav");
  const duration = 3601_000;
  const bytes = (duration / 1000) * 16000 * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(bytes + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  const handle = await open(file, "wx");
  await handle.write(header);
  await handle.truncate(bytes + 44);
  await handle.close();
  let partPath = "";
  let calls = 0;
  try {
    const result = await transcribeRemoteParts(
      file,
      duration,
      new AbortController().signal,
      async (part, length) => {
        partPath = part;
        calls++;
        assert.ok(length <= 3600_000);
        assert.ok((await stat(part)).size < 50 * 1024 * 1024);
        return { text: `这是第 ${calls} 段测试内容`, modelName: "synthetic-test" };
      },
      async () => {},
    );
    assert.equal(result.length, 5);
    assert.equal(result.at(-1)?.startMs, 3600_000);
    assert.equal((await stat(file)).size, bytes + 44);
    await assert.rejects(stat(partPath), /ENOENT/);
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      transcribeRemoteParts(
        file,
        duration,
        aborted.signal,
        async () => {
          throw new Error("must not upload");
        },
        async () => {},
      ),
    );
    assert.equal((await readFile(file)).subarray(0, 44).equals(header), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
