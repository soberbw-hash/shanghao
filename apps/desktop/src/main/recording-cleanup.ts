import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

import type { RecordingCleanupCandidate, RecordingCleanupReason } from "@private-voice/shared";

export const SHORT_RECORDING_MS = 5 * 60_000;
export const SILENT_RECORDING_PEAK_DB = -60;

interface RecordingProbeResult {
  durationMs?: number;
  maximumVolumeDb?: number;
  reason?: RecordingCleanupReason;
}

const finiteDecibels = (value: string | undefined): number | undefined => {
  if (!value || value === "-inf") return value === "-inf" ? Number.NEGATIVE_INFINITY : undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseRecordingProbeOutput = (
  output: string,
  exitCode: number | null,
): RecordingProbeResult => {
  if (exitCode !== 0) return { reason: "unreadable" };
  const durationMarker = output.indexOf("Duration:");
  const durationToken =
    durationMarker >= 0
      ? output
          .slice(durationMarker + "Duration:".length)
          .trimStart()
          .split(/[\s,]/u, 1)[0]
      : undefined;
  const durationParts = durationToken?.split(":").map(Number) ?? [];
  const [hours = Number.NaN, minutes = Number.NaN, durationSeconds = Number.NaN] = durationParts;
  const seconds = hours * 3_600 + minutes * 60 + durationSeconds;
  if (!Number.isFinite(seconds) || seconds <= 0) return { reason: "unreadable" };
  const durationMs = Math.round(seconds * 1_000);
  if (durationMs < SHORT_RECORDING_MS) return { durationMs, reason: "too_short" };

  const volumeMarker = output.lastIndexOf("max_volume:");
  const volumeToken =
    volumeMarker >= 0
      ? output
          .slice(volumeMarker + "max_volume:".length)
          .trimStart()
          .split(/\s/u, 1)[0]
      : undefined;
  const maximumVolumeDb = finiteDecibels(volumeToken);
  if (maximumVolumeDb === undefined) return { durationMs, reason: "unreadable" };
  if (maximumVolumeDb <= SILENT_RECORDING_PEAK_DB) {
    return { durationMs, maximumVolumeDb, reason: "silent" };
  }
  return { durationMs, maximumVolumeDb };
};

export const inspectRecordingForCleanup = async (
  filePath: string,
): Promise<RecordingCleanupCandidate | undefined> => {
  const executable = ffmpegPath;
  if (!executable) throw new Error("ffmpeg_runtime_unavailable");
  const result = await new Promise<RecordingProbeResult>((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        filePath,
        "-vn",
        "-sn",
        "-dn",
        "-threads",
        "1",
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true },
    );
    let output = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (output.length < 128_000) output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      // A slow decoder is not evidence that the user's recording is corrupt.
      resolve(timedOut ? {} : parseRecordingProbeOutput(output, code));
    });
  });
  return result.reason
    ? { filePath, reason: result.reason, durationMs: result.durationMs }
    : undefined;
};
