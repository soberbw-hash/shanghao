import type { AiRuntimePressure } from "@private-voice/shared";

export interface RuntimePressureChange {
  pressure: AiRuntimePressure;
  realtimePressureHigh: boolean;
  pressureReason?: string;
  notify: boolean;
  releaseQwenReason?: string;
}

const emptyPressure = (): AiRuntimePressure => ({
  inVoiceRoom: false,
  screenSharing: false,
  peerRecovering: false,
  latencyMs: 0,
  packetLossPercent: 0,
  rendererMemoryPressure: false,
  updatedAt: 0,
});

const pressureReasonFor = (pressure: AiRuntimePressure): string | undefined =>
  pressure.peerRecovering
    ? "peer_recovery"
    : pressure.screenSharing && (pressure.latencyMs > 180 || pressure.packetLossPercent > 3)
      ? "screen_share_network_pressure"
      : pressure.inVoiceRoom && (pressure.latencyMs > 260 || pressure.packetLossPercent > 5)
        ? "voice_network_pressure"
        : pressure.rendererMemoryPressure
          ? "memory_pressure"
          : undefined;

/** Owns pressure hysteresis and expiry; the caller applies each state to the scheduler. */
export class RuntimePressureController {
  private pressure = emptyPressure();
  private high = false;
  private reason?: string;
  private releaseTimer?: NodeJS.Timeout;
  private staleTimer?: NodeJS.Timeout;

  constructor(
    private readonly onChange: (change: RuntimePressureChange) => void,
    private readonly staleAfterMs = 30_000,
  ) {}

  get snapshot(): {
    pressure: AiRuntimePressure;
    realtimePressureHigh: boolean;
    pressureReason?: string;
  } {
    return {
      pressure: this.pressure,
      realtimePressureHigh: this.high,
      pressureReason: this.reason,
    };
  }

  update(pressure: AiRuntimePressure): void {
    this.clearStaleTimer();
    if (
      pressure.peerRecovering ||
      pressure.latencyMs > 0 ||
      pressure.packetLossPercent > 0 ||
      pressure.rendererMemoryPressure
    ) {
      this.staleTimer = setTimeout(() => this.expireTransientSignals(), this.staleAfterMs);
      this.staleTimer.unref();
    }
    const recordingChanged =
      Boolean(this.pressure.recordingActive) !== Boolean(pressure.recordingActive);
    this.pressure = pressure;
    const reason = pressureReasonFor(pressure);
    if (reason) {
      const notify = !this.high || this.reason !== reason || recordingChanged;
      this.clearReleaseTimer();
      this.high = true;
      this.reason = reason;
      this.publish(notify, notify ? reason : undefined);
      return;
    }
    if (!this.high || this.releaseTimer) {
      this.publish(recordingChanged);
      return;
    }
    this.releaseTimer = setTimeout(() => {
      this.releaseTimer = undefined;
      this.high = false;
      this.reason = undefined;
      this.publish(true);
    }, 8_000);
    this.publish(recordingChanged);
  }

  stop(): void {
    this.clearReleaseTimer();
    this.clearStaleTimer();
  }

  private expireTransientSignals(): void {
    this.staleTimer = undefined;
    // A stopped Renderer cannot confirm recovery. Retain room, recording and screen-share state.
    this.pressure = {
      ...this.pressure,
      peerRecovering: false,
      latencyMs: 0,
      packetLossPercent: 0,
      rendererMemoryPressure: false,
    };
    const wasHigh = this.high;
    this.clearReleaseTimer();
    this.high = false;
    this.reason = undefined;
    this.publish(wasHigh);
  }

  private publish(notify: boolean, releaseQwenReason?: string): void {
    this.onChange({
      pressure: this.pressure,
      realtimePressureHigh: this.high,
      pressureReason: this.reason,
      notify,
      releaseQwenReason,
    });
  }

  private clearReleaseTimer(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = undefined;
  }

  private clearStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = undefined;
  }
}
