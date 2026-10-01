import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordingClipWindow, recordingClipErrorMessage } from "@private-voice/shared";
import {
  commitRecordingClip,
  RecordingClipExporter,
  requireRecordingClipRequest,
  recordingClipFileName,
} from "../src/main/recording-clip-export";
import {
  readRecordingLibraryItems,
  registerRecordingInDirectory,
} from "../src/main/recording-library-core";
import { resolveFfmpegExecutable } from "../src/main/media-runtime";
import { probeRecordingMedia } from "../src/main/recording-media-probe";
import { runLocalProcess } from "../src/main/local-process";
import { requireExportedClip } from "../src/main/recording-clip-paths";

test("clip windows clamp both edges and reject invalid offsets and excessive lengths", () => {
  assert.deepEqual(
    [5_000, 30_000, 59_000].map(
      (offset) => recordingClipWindow(offset, 60_000, 20_000, 8_000).durationMs,
    ),
    [13_000, 28_000, 21_000],
  );
  // The proposal's 27 s at 59 s was an arithmetic error: [39 s, 60 s] is 21 s.
  for (const offset of [-1, 60_001, NaN, Infinity])
    assert.throws(
      () => recordingClipWindow(offset, 60_000, 20_000, 8_000),
      /clip_marker_out_of_range/,
    );
  assert.throws(() => recordingClipWindow(0, 2_000, 10_000, 5_000), /clip_too_short/);
  assert.throws(() => recordingClipWindow(30_000, 60_000, -1, 5_000), /clip_invalid_window/);
  assert.throws(() => recordingClipWindow(30_000, 60_000, 120_000, 1), /clip_invalid_window/);
  assert.equal(recordingClipWindow(0, 60_000, 0, 3_000).durationMs, 3_000);
});

test("clip IPC payload is nested, bounded and uses a saved marker identity", () => {
  const valid = {
    filePath: "recording.m4a",
    markerId: "saved-marker",
    beforeMs: 100_000,
    afterMs: 20_000,
  };
  assert.deepEqual(requireRecordingClipRequest(valid), valid);
  for (const value of [
    null,
    [],
    { ...valid, markerId: {} },
    { ...valid, filePath: "x".repeat(2_049) },
    { ...valid, beforeMs: "20" },
    { ...valid, afterMs: -1 },
  ])
    assert.throws(() => requireRecordingClipRequest(value), /clip_invalid/);
  assert.equal(
    recordingClipErrorMessage(new Error("Error invoking remote method: clip_component_missing")),
    "导出组件缺失，请重新安装上号",
  );
});

test("safe Chinese clip naming and atomic collision commits never overwrite", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-clips-name-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const name = recordingClipFileName("一号房:/\\", "2026-10-01T13:43:00Z", 0);
  assert.equal(name, "一号房___-1001-2143-名场面.m4a");
  const temporary = path.join(root, "temporary.m4a");
  await writeFile(temporary, "original clip");
  const results = await Promise.all(
    Array.from({ length: 3 }, () => commitRecordingClip(temporary, root, name)),
  );
  assert.equal(new Set(results).size, 3);
  assert.ok(results.some((file) => file.endsWith("-2.m4a")));
  assert.ok(results.some((file) => file.endsWith("-3.m4a")));
  for (const result of results) assert.equal(await readFile(result, "utf8"), "original clip");
});

test("real 60 s M4A exports preserve source, samples, boundaries and queued repeats", async (t) => {
  const executable = resolveFfmpegExecutable();
  if (!executable) return t.skip("FFmpeg not available");
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-clips-media-"));
  const exporter = new RecordingClipExporter();
  t.after(async () => {
    exporter.close();
    await rm(directory, { recursive: true, force: true });
  });
  const source = path.join(directory, "source.m4a");
  await runLocalProcess(
    executable,
    [
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=60",
      "-c:a",
      "aac",
      "-b:a",
      "32k",
      source,
    ],
    { timeoutMs: 30_000 },
  );
  await registerRecordingInDirectory(directory, source);
  await writeFile(
    path.join(directory, "source-精彩时刻.txt"),
    "上号录音 · 精彩时刻\n1. 00:00:05\n2. 00:00:30\n3. 00:00:59\n",
  );
  const recording = (await readRecordingLibraryItems(directory))[0]!;
  const before = await stat(source);
  const hash = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
  const exports = await Promise.all(
    recording.markers.map((marker) =>
      exporter.export(directory, {
        filePath: source,
        markerId: marker.id,
        beforeMs: 20_000,
        afterMs: 8_000,
      }),
    ),
  );
  const pcmFile = path.join(directory, "fade.pcm");
  await runLocalProcess(
    executable,
    ["-nostdin", "-i", exports[0]!.filePath, "-f", "s16le", "-ac", "1", "-ar", "48000", pcmFile],
    { timeoutMs: 30_000 },
  );
  const pcm = await readFile(pcmFile);
  const rms = (start: number, samples: number) =>
    Math.sqrt(
      Array.from(
        { length: samples },
        (_, index) => (pcm.readInt16LE((start + index) * 2) / 32768) ** 2,
      ).reduce((sum, value) => sum + value, 0) / samples,
    );
  assert.ok(rms(0, 480) < rms(24_000, 480) * 0.3, "fade-in lowers initial PCM amplitude");
  assert.ok(
    rms(pcm.length / 2 - 480, 480) < rms(24_000, 480) * 0.3,
    "fade-out lowers final PCM amplitude",
  );
  assert.equal(await requireExportedClip(directory, exports[0]!.filePath), exports[0]!.filePath);
  await assert.rejects(requireExportedClip(directory, source), /clip_invalid_request/);
  await assert.rejects(requireExportedClip(directory, pcmFile), /clip_invalid_request/);
  await assert.rejects(
    requireExportedClip(directory, path.join(directory, "名场面", ".partial.m4a")),
    /clip_invalid_request/,
  );
  for (const [index, clip] of exports.entries()) {
    const media = await probeRecordingMedia(clip.filePath);
    assert.ok(Math.abs(media.durationMs - [13_000, 28_000, 21_000][index]!) <= 100);
    assert.match(media.inputFormat!, /48000 Hz/);
    assert.equal(path.dirname(clip.filePath), await realpath(path.join(directory, "名场面")));
  }
  const repeated = await exporter.export(directory, {
    filePath: source,
    markerId: recording.markers[0]!.id,
    beforeMs: 20_000,
    afterMs: 8_000,
  });
  assert.notEqual(repeated.filePath, exports[0]!.filePath);
  assert.equal((await stat(source)).mtimeMs, before.mtimeMs);
  assert.equal((await stat(source)).size, before.size);
  assert.equal(
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex"),
    hash,
  );
  assert.ok(
    !(await readdir(path.join(directory, "名场面"))).some((name) => name.includes("partial")),
  );
  await assert.rejects(
    exporter.export(directory, {
      filePath: path.join(os.tmpdir(), "outside.m4a"),
      markerId: "id",
      beforeMs: 20_000,
      afterMs: 8_000,
    }),
    /clip_source_unreadable/,
  );
  await assert.rejects(
    exporter.export(directory, {
      filePath: source,
      markerId: "invented",
      beforeMs: 20_000,
      afterMs: 8_000,
    }),
    /clip_marker_missing/,
  );
  exporter.close();
  await assert.rejects(
    exporter.export(directory, {
      filePath: source,
      markerId: "id",
      beforeMs: 20_000,
      afterMs: 8_000,
    }),
    /clip_export_cancelled/,
  );
});
