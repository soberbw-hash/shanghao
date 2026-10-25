import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import {
  transcribeRemoteSources,
  type RemoteSourcePart,
} from "../src/main/remote-transcription-sources";

function wav(first: number, second: number) {
  const data = Buffer.alloc(44 + 60000 * 32);
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
  data.writeUInt32LE(data.length - 44, 40);
  for (let offset = 44; offset < data.length; offset += 2)
    data.writeInt16LE(offset < 44 + 30000 * 32 ? first : second, offset);
  return data;
}

test("members interleave chronologically; isolated failures preserve other members and resume only the gap", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-member-queue-"));
  const files = [path.join(directory, "a.wav"), path.join(directory, "b.wav")];
  try {
    await writeFile(files[0]!, wav(100, 101));
    await writeFile(files[1]!, wav(200, 201));
    const sources = files.map((filePath, index) => ({
      filePath,
      id: String(index),
      startMs: 0,
      durationMs: 60000,
      speakerId: `member-${index}`,
      displayNameSnapshot: `合成成员${index}`,
    }));
    const saved: RemoteSourcePart[] = [],
      calls: number[] = [];
    let fail = true;
    const run = () =>
      transcribeRemoteSources(
        files[0]!,
        60000,
        sources,
        new AbortController().signal,
        async (file, duration) => {
          assert.equal(duration, 30000);
          const bytes = await readFile(file),
            value = bytes.readInt16LE(bytes.indexOf(Buffer.from("data")) + 8);
          calls.push(value);
          if (fail && value === 100) throw Error("cloud_asr_http_500");
          return { text: "这是一段合成的成员语音。", modelName: "synthetic" };
        },
        async () => {},
        async (part) => {
          saved.push(part);
        },
        (start, duration, id) =>
          saved.find(
            (part) =>
              part.startMs === start && part.durationMs === duration && part.sourceId === id,
          ),
        { partMs: 30000, forcePcm: true },
      );
    await assert.rejects(run(), /cloud_asr_http_500/);
    assert.deepEqual(calls, [100, 200, 101, 201]);
    assert.equal(saved.length, 3);
    assert.deepEqual(new Set(saved.map((part) => part.sourceId)), new Set(["0", "1"]));
    fail = false;
    const result = await run();
    assert.deepEqual(
      calls,
      [100, 200, 101, 201, 100],
      "successful cached audio is never re-uploaded",
    );
    assert.deepEqual(
      result.map((part) => [part.sourceId, part.startMs]),
      [
        ["0", 0],
        ["1", 0],
        ["0", 30000],
        ["1", 30000],
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persistent service outages trip a three-window circuit breaker; auth never skips forward", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-member-circuit-"));
  try {
    const file = path.join(directory, "audio.wav");
    await writeFile(file, wav(100, 101));
    const sources = [0, 1].map((index) => ({
      filePath: file,
      id: String(index),
      startMs: 0,
      durationMs: 60000,
      speakerId: `member-${index}`,
      displayNameSnapshot: "合成",
    }));
    for (const [reason, expected] of [
      ["cloud_asr_http_500", 3],
      ["cloud_asr_http_401", 1],
    ] as const) {
      let calls = 0;
      await assert.rejects(
        transcribeRemoteSources(
          file,
          60000,
          sources,
          new AbortController().signal,
          async () => {
            calls++;
            throw Error(reason);
          },
          async () => {},
          async () => {},
          () => undefined,
          { partMs: 30000, forcePcm: true },
        ),
        new RegExp(reason),
      );
      assert.equal(calls, expected);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
