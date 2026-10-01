import type { RecordingCleanupCandidate, RecordingCleanupReason } from "@private-voice/shared";

import { resolveFfmpegExecutable } from "./media-runtime";
import { mainResourceScheduler } from "./main-resource-scheduler";
import { runLocalProcess } from "./local-process";

// A short recording is only an accidental tap, not an ordinary conversation.
// Five minutes incorrectly classified real 1–5 minute conversations as waste.
export const SHORT_RECORDING_MS = 10_000;
export const SILENT_RECORDING_PEAK_DB = -60;

/** Probe failures are review candidates, never proof that a recording is disposable. */
export const isAutomaticWasteCandidate = (
  candidate: RecordingCleanupCandidate | undefined,
): candidate is RecordingCleanupCandidate =>
  candidate?.reason === "too_short" || candidate?.reason === "silent";

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
  const executable = resolveFfmpegExecutable();
  if (!executable) throw new Error("ffmpeg_runtime_unavailable");
  const result = await mainResourceScheduler
    .runWork("recording-cleanup", async (signal): Promise<RecordingProbeResult> => {
      try {
        const output = await runLocalProcess(
          executable,
          [
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-i",
            filePath,
            "-vn",
            "-sn",
            "-dn",
            "-threads",
            "1",
            "-filter_threads",
            "1",
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
          ],
          { signal, timeoutMs: 30_000 },
        );
        return parseRecordingProbeOutput(output.stderr, 0);
      } catch (error) {
        // Pressure, cancellation and a slow decoder never prove a recording is disposable.
        const message = error instanceof Error ? error.message : "";
        return message.startsWith("ai_runtime_exit_") ? { reason: "unreadable" } : {};
      }
    })
    .catch((): RecordingProbeResult => ({}));
  return result.reason
    ? { filePath, reason: result.reason, durationMs: result.durationMs }
    : undefined;
};
