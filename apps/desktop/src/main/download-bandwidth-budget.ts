import { awaitTask, waitForTask } from "./task-cancellation";
import type { AiRuntimePressure } from "@private-voice/shared";

export const NORMAL_DOWNLOAD_BYTES_PER_SECOND = 64 * 1024 * 1024;
export const GAMING_DOWNLOAD_BYTES_PER_SECOND = 8 * 1024 * 1024;
export const REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND = 1024 * 1024;

export const backgroundDownloadPolicy = (state: {
  gameActive: boolean;
  pressure: AiRuntimePressure;
  realtimePressureHigh: boolean;
  pressureReason?: string;
}): { defer: boolean; bytesPerSecond: number; reason?: string } => {
  const critical =
    state.realtimePressureHigh ||
    state.pressure.peerRecovering ||
    (state.pressure.inVoiceRoom && state.pressure.screenSharing);
  const bytesPerSecond = critical
    ? REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND
    : state.gameActive || state.pressure.inVoiceRoom
      ? GAMING_DOWNLOAD_BYTES_PER_SECOND
      : NORMAL_DOWNLOAD_BYTES_PER_SECOND;
  const reason = state.realtimePressureHigh
    ? (state.pressureReason ?? "realtime_pressure")
    : state.pressure.peerRecovering
      ? "peer_recovery"
      : state.pressure.inVoiceRoom && state.pressure.screenSharing
        ? "voice_and_screen_share"
        : state.gameActive || state.pressure.inVoiceRoom
          ? "reduced_rate"
          : undefined;
  return { defer: critical, bytesPerSecond, reason };
};

/** Model and Runtime transfers share a bounded wait and one aggregate bandwidth budget. */
export class DownloadBandwidthBudget {
  private queue: Promise<void> = Promise.resolve();
  private windowStartedAt = 0;
  private windowBytes = 0;
  constructor(private readonly decision: () => { defer: boolean; bytesPerSecond: number }) {}

  consume(bytes: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error("ai_task_paused"));
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 8 * 1024 * 1024)
      return Promise.reject(new Error("invalid_download_chunk"));
    const deadline = Date.now() + 90_000;
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (signal?.aborted) throw new Error("ai_task_paused");
        if (Date.now() >= deadline) throw new Error("background_resource_wait_timeout");
        while (this.decision().defer) {
          if (Date.now() >= deadline) throw new Error("background_resource_wait_timeout");
          await waitForTask(500, signal);
        }
        if (signal?.aborted) throw new Error("ai_task_paused");
        const now = Date.now();
        if (now - this.windowStartedAt >= 1_000) {
          this.windowStartedAt = now;
          this.windowBytes = 0;
        }
        this.windowBytes += bytes;
        const delay = Math.max(
          0,
          Math.ceil(
            (this.windowBytes / this.decision().bytesPerSecond) * 1_000 -
              (now - this.windowStartedAt),
          ),
        );
        if (delay) await waitForTask(delay, signal);
      });
    this.queue = operation;
    return awaitTask(operation, signal);
  }
}
