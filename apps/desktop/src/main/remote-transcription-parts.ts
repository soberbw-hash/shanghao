import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveFfmpegExecutable } from "./media-runtime";
import { runLocalProcess } from "./local-process";
import { mainResourceScheduler } from "./main-resource-scheduler";

const PART_MS = 5 * 60_000;
interface RemotePart {
  startMs: number;
  durationMs: number;
  text: string;
  modelName: string;
}
export const remoteTranscriptionRanges = (durationMs: number, partMs = PART_MS) => {
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error("recording_duration_unavailable");
  if (!Number.isFinite(partMs) || partMs <= 0 || partMs > PART_MS)
    throw new Error("invalid_remote_part_duration");
  return Array.from({ length: Math.ceil(durationMs / partMs) }, (_, index) => ({
    startMs: index * partMs,
    durationMs: Math.min(partMs, durationMs - index * partMs),
  }));
};

/** Only generated files in this task's private temporary directory are removed. */
export const transcribeRemoteParts = async (
  filePath: string,
  durationMs: number,
  signal: AbortSignal,
  transcribe: (file: string, duration: number) => Promise<{ text: string; modelName: string }>,
  onPart: (index: number, count: number) => Promise<void>,
  onCompleted?: (part: RemotePart, index: number, count: number) => Promise<void>,
  cached?: (startMs: number, durationMs: number) => RemotePart | undefined,
  partMs = PART_MS,
  forceConvert = false,
  audioOffsetMs = 0,
) => {
  if (!Number.isFinite(audioOffsetMs) || audioOffsetMs < 0)
    throw Error("invalid_remote_audio_offset");
  const size = (await stat(filePath)).size;
  const ranges =
    durationMs <= partMs && size <= 50 * 1024 * 1024
      ? [{ startMs: 0, durationMs }]
      : remoteTranscriptionRanges(durationMs, partMs);
  if (!forceConvert && !audioOffsetMs && ranges.length === 1 && size <= 50 * 1024 * 1024) {
    signal.throwIfAborted();
    await onPart(1, 1);
    const part = cached?.(0, durationMs) ?? {
      ...(await transcribe(filePath, durationMs)),
      ...ranges[0]!,
    };
    signal.throwIfAborted();
    await onCompleted?.(part, 1, 1);
    return [part];
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
      const saved = cached?.(range.startMs, range.durationMs);
      if (saved) {
        await onCompleted?.(saved, index + 1, ranges.length);
        results.push(saved);
        continue;
      }
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
              String((audioOffsetMs + range.startMs) / 1000),
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
      signal.throwIfAborted();
      const part = { ...range, ...result };
      await onCompleted?.(part, index + 1, ranges.length);
      results.push(part);
    }
    return results;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
