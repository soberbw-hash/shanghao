import type { AiProcessingMode, AiRuntimePressure, AiTaskKind } from "@private-voice/shared";
import type { HostResourceCapacity } from "./host-resource-capacity";

export interface SchedulerState {
  processingMode: AiProcessingMode;
  gameActive: boolean;
  pressure: AiRuntimePressure;
  realtimePressureHigh: boolean;
  pressureReason?: string;
}

export interface ScheduledAiDecision {
  runnable: boolean;
  reason?: string;
  resourceMode: "low" | "normal";
}

/** Pure admission policy, independent of queues, timers, processes and UI notifications. */
export const aiResourcePolicy = (
  state: SchedulerState,
  kind: AiTaskKind,
  manual: boolean,
  capacity: HostResourceCapacity,
): ScheduledAiDecision => {
  const realtime =
    state.pressure.inVoiceRoom || state.pressure.screenSharing || state.pressure.peerRecovering;
  const reason = manual
    ? undefined
    : state.realtimePressureHigh
      ? (state.pressureReason ?? "realtime_pressure")
      : state.processingMode === "manual"
        ? "manual_only"
        : state.pressure.recordingActive
          ? "recording_priority"
          : state.gameActive && state.processingMode === "after_game"
            ? "waiting_for_game_to_finish"
            : capacity.availableMemoryBytes < 1024 ** 3
              ? "memory_pressure"
              : realtime && (capacity.cpuBusyRatio ?? 0) > 0.95
                ? "cpu_pressure"
                : undefined;
  if (reason) return { runnable: false, reason, resourceMode: "low" };
  const low =
    state.processingMode === "low_resource" ||
    state.gameActive ||
    state.pressure.recordingActive ||
    realtime ||
    (kind !== "transcription" && state.pressure.rendererMemoryPressure) ||
    (capacity.cpuBusyRatio ?? 0) > 0.85 ||
    (capacity.gpuFreeBytes !== undefined && capacity.gpuFreeBytes < 768 * 1024 ** 2) ||
    capacity.availableMemoryBytes < 2 * 1024 ** 3;
  return { runnable: true, resourceMode: low ? "low" : "normal" };
};
