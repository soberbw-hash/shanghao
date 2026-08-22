import type { AiProcessingMode, AiRuntimePressure, AiTaskKind } from "@private-voice/shared";

export const RESOURCE_PRIORITY = {
  realtimeVoice: 900,
  peerRecovery: 800,
  screenShare: 700,
  foregroundExperience: 600,
  recording: 500,
  aiInference: 400,
  aiOrganization: 300,
  backgroundDownload: 200,
  maintenance: 100,
} as const;

export const NORMAL_DOWNLOAD_BYTES_PER_SECOND = 2 * 1024 * 1024;
export const GAMING_DOWNLOAD_BYTES_PER_SECOND = 256 * 1024;
export const REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND = 128 * 1024;

interface SchedulerState {
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

export interface BackgroundDownloadDecision {
  defer: boolean;
  bytesPerSecond: number;
  reason?: string;
}

const initialPressure = (): AiRuntimePressure => ({
  inVoiceRoom: false,
  screenSharing: false,
  peerRecovering: false,
  latencyMs: 0,
  packetLossPercent: 0,
  rendererMemoryPressure: false,
  updatedAt: 0,
});

/** One source of truth for background work yielding to realtime room features. */
export class ResourceScheduler {
  private state: SchedulerState = {
    processingMode: "after_game",
    gameActive: false,
    pressure: initialPressure(),
    realtimePressureHigh: false,
  };

  update(update: Partial<SchedulerState>): void {
    this.state = { ...this.state, ...update };
  }

  aiDecision(kind: AiTaskKind, manualRequest: boolean): ScheduledAiDecision {
    if (this.state.processingMode === "manual" && !manualRequest)
      return { runnable: false, reason: "manual_only", resourceMode: "low" };
    if (this.state.realtimePressureHigh && !manualRequest) {
      return {
        runnable: false,
        reason: this.state.pressureReason ?? "realtime_pressure",
        resourceMode: "low",
      };
    }
    if (this.state.gameActive && this.state.processingMode === "after_game" && !manualRequest) {
      return { runnable: false, reason: "waiting_for_game_to_finish", resourceMode: "low" };
    }
    const realtimeFeatureActive =
      this.state.pressure.inVoiceRoom ||
      this.state.pressure.screenSharing ||
      this.state.pressure.peerRecovering;
    const organizing = kind !== "transcription";
    return {
      runnable: true,
      resourceMode:
        this.state.processingMode === "low_resource" ||
        this.state.gameActive ||
        realtimeFeatureActive ||
        (organizing && this.state.pressure.rendererMemoryPressure)
          ? "low"
          : "normal",
    };
  }

  downloadBytesPerSecond(): number {
    if (
      this.state.realtimePressureHigh ||
      this.state.pressure.peerRecovering ||
      (this.state.pressure.inVoiceRoom && this.state.pressure.screenSharing)
    ) {
      return REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND;
    }
    if (this.state.gameActive || this.state.pressure.inVoiceRoom)
      return GAMING_DOWNLOAD_BYTES_PER_SECOND;
    return NORMAL_DOWNLOAD_BYTES_PER_SECOND;
  }

  backgroundDownloadDecision(): BackgroundDownloadDecision {
    const bytesPerSecond = this.downloadBytesPerSecond();
    if (this.state.realtimePressureHigh)
      return {
        defer: true,
        bytesPerSecond,
        reason: this.state.pressureReason ?? "realtime_pressure",
      };
    if (this.state.pressure.peerRecovering)
      return { defer: true, bytesPerSecond, reason: "peer_recovery" };
    if (this.state.pressure.inVoiceRoom && this.state.pressure.screenSharing)
      return { defer: true, bytesPerSecond, reason: "voice_and_screen_share" };
    return {
      defer: false,
      bytesPerSecond,
      reason: this.state.gameActive || this.state.pressure.inVoiceRoom ? "reduced_rate" : undefined,
    };
  }

  shouldReleaseQwen(): { release: boolean; reason?: string } {
    if (this.state.pressure.peerRecovering) return { release: true, reason: "peer_recovery" };
    if (this.state.realtimePressureHigh)
      return { release: true, reason: this.state.pressureReason ?? "realtime_pressure" };
    if (this.state.gameActive && this.state.processingMode === "after_game")
      return { release: true, reason: "processing_deferred" };
    return { release: false };
  }
}
