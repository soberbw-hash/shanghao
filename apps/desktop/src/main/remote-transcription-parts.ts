import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegExecutable } from "./media-runtime";
import { runLocalProcess } from "./local-process";
import { mainResourceScheduler } from "./main-resource-scheduler";

const PART_MS = 15 * 60_000;
export const remoteTranscriptionRanges = (durationMs: number) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("recording_duration_unavailable");
  return Array.from({ length: Math.ceil(durationMs / PART_MS) }, (_, index) => ({
    startMs: index * PART_MS,
    durationMs: Math.min(PART_MS, durationMs - index * PART_MS),
  }));
};

/** Only generated files in this task's private temporary directory are removed. */
export const transcribeRemoteParts = async (
  filePath: string,
  durationMs: number,
  signal: AbortSignal,
  transcribe: (file: string, duration: number) => Promise<{ text: string; modelName: string }>,
  onPart: (index: number, count: number) => Promise<void>,
) => {
  const size = (await stat(filePath)).size;
  const ranges =
    durationMs <= 60 * 60_000 && size <= 50 * 1024 * 1024
      ? [{ startMs: 0, durationMs }]
      : remoteTranscriptionRanges(durationMs);
  if (ranges.length === 1 && size <= 50 * 1024 * 1024) {
    signal.throwIfAborted();
    return [{ ...(await transcribe(filePath, durationMs)), ...ranges[0]! }];
  }
  const executable = resolveFfmpegExecutable();
  if (!executable) throw new Error("ffmpeg_missing");
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-parts-"));
  const results: Array<{ startMs: number; durationMs: number; text: string; modelName: string }> =
    [];
  try {
    for (const [index, range] of ranges.entries()) {
      signal.throwIfAborted();
      await onPart(index + 1, ranges.length);
      const output = path.join(directory, "part.wav");
      await mainResourceScheduler.runWork(
        "recording-export",
        async (workSignal) => {
          await runLocalProcess(
            executable,
            [
              "-nostdin",
              "-hide_banner",
              "-loglevel",
              "error",
              "-y",
              "-ss",
              String(range.startMs / 1000),
              "-i",
              filePath,
              "-t",
              String(range.durationMs / 1000),
              "-vn",
              "-ar",
              "16000",
              "-ac",
              "1",
              "-c:a",
              "pcm_s16le",
              "-threads",
              "1",
              output,
            ],
            { signal: workSignal, timeoutMs: 5 * 60_000 },
          );
        },
        signal,
      );
      signal.throwIfAborted();
      const result = await transcribe(output, range.durationMs);
      results.push({ ...range, ...result });
    }
    return results;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
