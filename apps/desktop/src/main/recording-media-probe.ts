import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { resolveFfmpegExecutable } from "./media-runtime";
import { terminateProcessTree } from "./process-tree";
import { mainResourceScheduler } from "./main-resource-scheduler";

const PROBE_TIMEOUT_MS = 30_000;
const MAX_PROBE_OUTPUT_CHARS = 64 * 1024;

export const parseRecordingMediaProbe = (
  output: string,
): { durationMs: number; inputFormat?: string } | undefined => {
  // FFmpeg prints this metadata on stderr even though `-i` exits nonzero.
  // eslint-disable-next-line security/detect-unsafe-regex
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const seconds = match
    ? Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])
    : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const audioLine = output.match(/Audio:\s*([^\r\n]+)/i)?.[1]?.trim();
  return { durationMs: Math.round(seconds * 1_000), inputFormat: audioLine };
};

interface RecordingMediaProbeOptions {
  signal?: AbortSignal;
  startProcess?: (executable: string, args: string[]) => ChildProcessWithoutNullStreams;
}

/** The probe owns its child process and keeps at most a bounded stderr prefix. */
export const probeRecordingMedia = async (
  filePath: string,
  options: RecordingMediaProbeOptions = {},
): Promise<{ durationMs: number; inputFormat?: string }> =>
  mainResourceScheduler.runWork(
    "recording-probe",
    (signal) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error("ai_task_paused"));
        const executable = resolveFfmpegExecutable();
        if (!executable) return reject(new Error("ffmpeg_missing"));
        let child: ChildProcessWithoutNullStreams;
        try {
          const args = ["-nostdin", "-hide_banner", "-i", filePath];
          child =
            options.startProcess?.(executable, args) ??
            spawn(executable, args, { windowsHide: true });
        } catch {
          return reject(new Error("ffmpeg_probe_failed"));
        }
        let output = "";
        let settled = false;
        let terminationReason: "ai_task_paused" | "ffmpeg_probe_timeout" | undefined;
        const abort = () => terminate("ai_task_paused");
        const finish = (result?: { durationMs: number; inputFormat?: string }, error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          signal.removeEventListener("abort", abort);
          if (error) reject(error);
          else if (result) resolve(result);
          else reject(new Error("recording_duration_unavailable"));
        };
        const terminate = (reason: NonNullable<typeof terminationReason>) => {
          if (settled || terminationReason) return;
          terminationReason = reason;
          void terminateProcessTree(child).then(() => finish(undefined, new Error(reason)));
        };
        const timeout = setTimeout(() => terminate("ffmpeg_probe_timeout"), PROBE_TIMEOUT_MS);
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (value: string) => {
          if (output.length < MAX_PROBE_OUTPUT_CHARS)
            output += value.slice(0, MAX_PROBE_OUTPUT_CHARS - output.length);
        });
        child.on("error", () =>
          finish(undefined, new Error(terminationReason ?? "ffmpeg_probe_failed")),
        );
        child.on("close", () =>
          terminationReason
            ? finish(undefined, new Error(terminationReason))
            : finish(parseRecordingMediaProbe(output)),
        );
        child.stdin.end();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      }),
    options.signal,
  );
