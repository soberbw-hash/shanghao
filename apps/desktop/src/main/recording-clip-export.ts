import { randomUUID } from "node:crypto";
import { access, link, lstat, mkdir, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {
  recordingClipWindow,
  type RecordingClipRequest,
  type RecordingClipResult,
} from "@private-voice/shared";
import { requireRecordingFileInDirectory } from "./recording-ipc-validation";
import { readRecordingLibraryItems } from "./recording-library-core";
import { probeRecordingMedia } from "./recording-media-probe";
import { resolveFfmpegExecutable } from "./media-runtime";
import { runLocalProcess } from "./local-process";
import { mainResourceScheduler } from "./main-resource-scheduler";

export const requireRecordingClipRequest = (value: unknown): RecordingClipRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("clip_invalid_request");
  const request = value as RecordingClipRequest;
  if (
    typeof request.filePath !== "string" ||
    !request.filePath ||
    request.filePath.length > 2_048 ||
    typeof request.markerId !== "string" ||
    !request.markerId ||
    request.markerId.length > 160
  )
    throw new Error("clip_invalid_request");
  recordingClipWindow(120_000, 240_000, request.beforeMs, request.afterMs);
  return {
    filePath: request.filePath,
    markerId: request.markerId,
    beforeMs: request.beforeMs,
    afterMs: request.afterMs,
  };
};

export const recordingClipFileName = (
  roomName: string,
  createdAt: string,
  offsetMs: number,
): string => {
  const date = new Date(Date.parse(createdAt) + offsetMs + 8 * 3_600_000);
  const digits = (value: number) => String(value).padStart(2, "0");
  const name =
    roomName
      // Windows file names cannot contain ASCII control characters.
      // eslint-disable-next-line no-control-regex
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/g, "")
      .slice(0, 40) || "上号";
  return `${name}-${digits(date.getUTCMonth() + 1)}${digits(date.getUTCDate())}-${digits(date.getUTCHours())}${digits(date.getUTCMinutes())}-名场面.m4a`;
};

export const requireClipDirectory = async (directory: string): Promise<string> => {
  const clips = path.join(directory, "名场面");
  await mkdir(clips, { recursive: true });
  const [root, actual, info] = await Promise.all([
    realpath(directory),
    realpath(clips),
    lstat(clips),
  ]);
  if (info.isSymbolicLink() || !info.isDirectory() || path.dirname(actual) !== root)
    throw new Error("clip_write_failed");
  return actual;
};

/** A hard-link commit is atomic and fails on collisions; never replaces an existing file. */
export const commitRecordingClip = async (
  temporary: string,
  directory: string,
  name: string,
): Promise<string> => {
  const stem = path.basename(name, ".m4a");
  for (let suffix = 1; suffix <= 1_000; suffix++) {
    const target = path.join(directory, `${stem}${suffix === 1 ? "" : `-${suffix}`}.m4a`);
    try {
      await link(temporary, target);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new Error("clip_write_failed", { cause: error });
    }
  }
  throw new Error("clip_write_failed");
};

/** Owns a bounded FIFO and its active encoder. Closing never removes a completed clip. */
export class RecordingClipExporter {
  private queue: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private closed = false;
  private readonly cancellation = new AbortController();
  export(directory: string, input: unknown): Promise<RecordingClipResult> {
    const request = requireRecordingClipRequest(input);
    if (this.closed) return Promise.reject(new Error("clip_export_cancelled"));
    if (this.pending >= 16) return Promise.reject(new Error("clip_queue_full"));
    const queuedAt = Date.now();
    this.pending++;
    const job = this.queue
      .catch(() => undefined)
      .then(() => {
        if (this.closed) throw new Error("clip_export_cancelled");
        if (Date.now() - queuedAt > 5 * 60_000) throw new Error("clip_export_timeout");
        return this.exportOnce(directory, request);
      })
      .finally(() => {
        this.pending--;
      });
    this.queue = job;
    return job;
  }
  close(): void {
    this.closed = true;
    this.cancellation.abort();
  }

  private async exportOnce(
    directory: string,
    request: RecordingClipRequest,
  ): Promise<RecordingClipResult> {
    const signal = this.cancellation.signal;
    const source = await requireRecordingFileInDirectory(directory, request.filePath).catch(() => {
      throw new Error("clip_source_unreadable");
    });
    await access(source).catch(() => {
      throw new Error("clip_source_unreadable");
    });
    const recording = (await readRecordingLibraryItems(directory)).find(
      (item) => item.filePath === source,
    );
    const marker = recording?.markers.find((item) => item.id === request.markerId);
    if (!recording || !marker) throw new Error("clip_marker_missing");
    const executable = resolveFfmpegExecutable();
    if (!executable) throw new Error("clip_component_missing");
    const media = await probeRecordingMedia(source, { signal }).catch((error: Error) => {
      throw new Error(signal.aborted ? "clip_export_cancelled" : "clip_source_unreadable", {
        cause: error,
      });
    });
    const window = recordingClipWindow(
      marker.offsetMs,
      media.durationMs,
      request.beforeMs,
      request.afterMs,
    );
    const clips = await requireClipDirectory(directory).catch((error) => {
      throw new Error("clip_write_failed", { cause: error });
    });
    const temporary = path.join(clips, `.clip-${randomUUID()}.partial.m4a`);
    try {
      await mainResourceScheduler
        .runWork(
          "recording-export",
          async (leaseSignal) => {
            await runLocalProcess(
              executable,
              [
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-n",
                "-ss",
                String(window.startMs / 1_000),
                "-i",
                source,
                "-t",
                String(window.durationMs / 1_000),
                "-map",
                "0:a:0",
                "-vn",
                "-map_metadata",
                "-1",
                "-c:a",
                "aac",
                "-b:a",
                /stereo/i.test(media.inputFormat ?? "") ? "64k" : "32k",
                "-threads",
                "1",
                "-af",
                `afade=t=in:d=0.08,afade=t=out:st=${window.durationMs / 1_000 - 0.08}:d=0.08`,
                "-movflags",
                "+faststart",
                temporary,
              ],
              { signal: leaseSignal, timeoutMs: 90_000 },
            );
          },
          signal,
        )
        .catch((error: Error) => {
          const code = signal.aborted
            ? "clip_export_cancelled"
            : error.message.includes("timeout")
              ? "clip_export_timeout"
              : /No space|Permission denied|Error opening output|Read-only/i.test(error.message)
                ? "clip_write_failed"
                : "clip_export_failed";
          throw new Error(code, { cause: error });
        });
      if (signal.aborted) throw new Error("clip_export_cancelled");
      if ((await stat(temporary)).size < 1) throw new Error("clip_export_failed");
      // Recheck that the selected folder still resolves to our output directory before commit.
      if ((await requireClipDirectory(directory)) !== clips) throw new Error("clip_write_failed");
      const filePath = await commitRecordingClip(
        temporary,
        clips,
        recordingClipFileName(recording.roomName ?? "上号", recording.createdAt, marker.offsetMs),
      );
      return { filePath, fileName: path.basename(filePath), ...window };
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}
