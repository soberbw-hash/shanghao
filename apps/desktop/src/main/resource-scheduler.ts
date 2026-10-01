import type { AiProcessingMode, AiRuntimePressure, AiTaskKind } from "@private-voice/shared";
import { freemem } from "node:os";
import { awaitTask, waitForTask } from "./task-cancellation";

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

// This is one aggregate limit shared by every active model download. Keep the
// idle ceiling above typical home broadband while retaining explicit headroom
// when realtime voice, screen sharing, or a game needs the network.
export const NORMAL_DOWNLOAD_BYTES_PER_SECOND = 64 * 1024 * 1024;
export const GAMING_DOWNLOAD_BYTES_PER_SECOND = 8 * 1024 * 1024;
export const REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND = 1024 * 1024;

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

export interface AiComputeLease {
  resourceMode: "low" | "normal";
  signal: AbortSignal;
  release: () => void;
}

interface ActiveAiCompute {
  id: number;
  kind: AiTaskKind;
  manualRequest: boolean;
  controller: AbortController;
  stoppingReason?:
    | "cancelled"
    | "recording_priority"
    | "realtime_pressure"
    | "manual_only"
    | "waiting_for_game_to_finish";
}

interface AiComputeWaiter {
  id: number;
  kind: AiTaskKind;
  manualRequest: boolean;
  priority: number;
  signal?: AbortSignal;
  onAbort: () => void;
  resolve: (lease: AiComputeLease) => void;
  reject: (error: Error) => void;
}

const MAX_AI_COMPUTE_WAITERS = 32;
const MAX_AI_COMPUTE_EVENTS = 64;
export interface AiComputeEvent {
  id: number;
  at: number;
  kind: AiTaskKind;
  manualRequest: boolean;
  phase: "queued" | "started" | "stopping" | "released" | "cancelled" | "denied";
  reason?: string;
}
const computePriority = (kind: AiTaskKind, manualRequest: boolean): number =>
  (manualRequest ? 1_000 : 0) +
  (kind === "transcription" ? RESOURCE_PRIORITY.aiInference : RESOURCE_PRIORITY.aiOrganization);

const initialPressure = (): AiRuntimePressure => ({
  inVoiceRoom: false,
  recordingActive: false,
  screenSharing: false,
  peerRecovering: false,
  latencyMs: 0,
  packetLossPercent: 0,
  rendererMemoryPressure: false,
  updatedAt: 0,
});

/** One source of truth for background work yielding to realtime room features. */
export class ResourceScheduler {
  private downloadQueue: Promise<void> = Promise.resolve();
  private downloadWindowStartedAt = 0;
  private downloadWindowBytes = 0;
  constructor(private readonly availableMemoryBytes = freemem) {}

  /** Model and Runtime transfers share one bandwidth budget and pressure decision. */
  consumeDownloadBytes(bytes: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error("ai_task_paused"));
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 8 * 1024 * 1024)
      return Promise.reject(new Error("invalid_download_chunk"));
    const deadline = Date.now() + 90_000;
    const operation = this.downloadQueue
      .catch(() => undefined)
      .then(async () => {
        if (signal?.aborted) throw new Error("ai_task_paused");
        if (Date.now() >= deadline) throw new Error("background_resource_wait_timeout");
        while (this.backgroundDownloadDecision().defer) {
          if (Date.now() >= deadline) throw new Error("background_resource_wait_timeout");
          await waitForTask(500, signal);
        }
        if (signal?.aborted) throw new Error("ai_task_paused");
        const now = Date.now();
        if (now - this.downloadWindowStartedAt >= 1_000) {
          this.downloadWindowStartedAt = now;
          this.downloadWindowBytes = 0;
        }
        this.downloadWindowBytes += bytes;
        const delay = Math.max(
          0,
          Math.ceil(
            (this.downloadWindowBytes / this.downloadBytesPerSecond()) * 1_000 -
              (now - this.downloadWindowStartedAt),
          ),
        );
        if (delay) await waitForTask(delay, signal);
      });
    this.downloadQueue = operation;
    return awaitTask(operation, signal);
  }
  private activeCompute?: ActiveAiCompute;
  private readonly computeWaiters: AiComputeWaiter[] = [];
  private readonly computeEvents: AiComputeEvent[] = [];
  private nextComputeId = 0;
  private readonly denials: Record<string, number> = Object.create(null);
  private denialTotal = 0;
  private lastDenialReason?: string;
  private lastDenialAt?: number;

  getDenialSnapshot() {
    return {
      total: this.denialTotal,
      byReason: { ...this.denials },
      lastReason: this.lastDenialReason,
      lastAt: this.lastDenialAt,
    };
  }

  getComputeSnapshot(): {
    activeKind?: AiTaskKind;
    activePhase?: "running" | "stopping";
    stoppingReason?: ActiveAiCompute["stoppingReason"];
    waiting: number;
  } {
    return {
      activeKind: this.activeCompute?.kind,
      activePhase: this.activeCompute
        ? this.activeCompute.controller.signal.aborted
          ? "stopping"
          : "running"
        : undefined,
      stoppingReason: this.activeCompute?.stoppingReason,
      waiting: this.computeWaiters.length,
    };
  }

  getComputeTimeline(): AiComputeEvent[] {
    return this.computeEvents.map((event) => ({ ...event }));
  }

  private recordComputeEvent(
    task: Pick<AiComputeEvent, "id" | "kind" | "manualRequest">,
    phase: AiComputeEvent["phase"],
    reason?: string,
  ): void {
    this.computeEvents.push({ ...task, phase, reason, at: Date.now() });
    if (this.computeEvents.length > MAX_AI_COMPUTE_EVENTS) this.computeEvents.shift();
  }

  isManualTextComputeActive(): boolean {
    return Boolean(
      this.activeCompute?.manualRequest && this.activeCompute.kind !== "transcription",
    );
  }

  async acquireCompute(
    kind: AiTaskKind,
    manualRequest: boolean,
    signal?: AbortSignal,
  ): Promise<AiComputeLease> {
    if (signal?.aborted) throw new Error("ai_task_paused");
    const id = ++this.nextComputeId;
    if (!this.activeCompute && this.computeWaiters.length === 0) {
      const decision = this.aiDecision(kind, manualRequest);
      if (!decision.runnable) {
        this.recordComputeEvent({ id, kind, manualRequest }, "denied", decision.reason);
        throw new Error(decision.reason);
      }
      return this.grantCompute(id, kind, manualRequest, decision.resourceMode, signal);
    }
    if (this.computeWaiters.length >= MAX_AI_COMPUTE_WAITERS) {
      this.recordComputeEvent({ id, kind, manualRequest }, "denied", "ai_compute_queue_full");
      throw new Error("ai_compute_queue_full");
    }
    return new Promise<AiComputeLease>((resolve, reject) => {
      const waiter: AiComputeWaiter = {
        id,
        kind,
        manualRequest,
        priority: computePriority(kind, manualRequest),
        signal,
        onAbort: () => {
          const index = this.computeWaiters.indexOf(waiter);
          if (index < 0) return;
          this.computeWaiters.splice(index, 1);
          this.recordComputeEvent(waiter, "cancelled", "ai_task_paused");
          reject(new Error("ai_task_paused"));
        },
        resolve,
        reject,
      };
      const index = this.computeWaiters.findIndex((pending) => pending.priority < waiter.priority);
      this.computeWaiters.splice(index < 0 ? this.computeWaiters.length : index, 0, waiter);
      this.recordComputeEvent(waiter, "queued");
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (signal?.aborted) waiter.onAbort();
    });
  }

  cancelWaitingCompute(): void {
    for (const waiter of this.computeWaiters.splice(0)) {
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      this.recordComputeEvent(waiter, "cancelled", "ai_task_paused");
      waiter.reject(new Error("ai_task_paused"));
    }
  }

  cancelCompute(): void {
    this.cancelWaitingCompute();
    if (this.activeCompute) {
      this.activeCompute.stoppingReason = "cancelled";
      if (!this.activeCompute.controller.signal.aborted)
        this.recordComputeEvent(this.activeCompute, "stopping", "cancelled");
      this.activeCompute.controller.abort();
    }
  }

  private grantCompute(
    id: number,
    kind: AiTaskKind,
    manualRequest: boolean,
    resourceMode: "low" | "normal",
    signal?: AbortSignal,
  ): AiComputeLease {
    const controller = new AbortController();
    const active: ActiveAiCompute = { id, kind, manualRequest, controller };
    const forwardAbort = () => {
      active.stoppingReason = "cancelled";
      if (!controller.signal.aborted) this.recordComputeEvent(active, "stopping", "cancelled");
      controller.abort();
    };
    this.activeCompute = active;
    this.recordComputeEvent(active, "started");
    signal?.addEventListener("abort", forwardAbort, { once: true });
    if (signal?.aborted) forwardAbort();
    let released = false;
    return {
      resourceMode,
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        signal?.removeEventListener("abort", forwardAbort);
        if (this.activeCompute === active) this.activeCompute = undefined;
        this.recordComputeEvent(active, "released");
        this.grantNextCompute();
      },
    };
  }

  private grantNextCompute(): void {
    if (this.activeCompute) return;
    while (this.computeWaiters.length > 0) {
      const waiter = this.computeWaiters.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      if (waiter.signal?.aborted) {
        this.recordComputeEvent(waiter, "cancelled", "ai_task_paused");
        waiter.reject(new Error("ai_task_paused"));
        continue;
      }
      const decision = this.aiDecision(waiter.kind, waiter.manualRequest);
      if (!decision.runnable) {
        this.recordComputeEvent(waiter, "denied", decision.reason);
        waiter.reject(new Error(decision.reason));
        continue;
      }
      waiter.resolve(
        this.grantCompute(
          waiter.id,
          waiter.kind,
          waiter.manualRequest,
          decision.resourceMode,
          waiter.signal,
        ),
      );
      return;
    }
  }

  private denied(reason: string): ScheduledAiDecision {
    // Bounded reason vocabulary; counts are decision observations, not distinct jobs.
    const key = [
      "realtime_pressure",
      "manual_only",
      "waiting_for_game_to_finish",
      "peer_recovery",
      "packet_loss",
      "latency",
      "renderer_memory_pressure",
      "screen_share_network_pressure",
      "voice_network_pressure",
      "memory_pressure",
      "recording_priority",
    ].includes(reason)
      ? reason
      : "other";
    this.denials[key] = Math.min(Number.MAX_SAFE_INTEGER, (this.denials[key] ?? 0) + 1);
    this.denialTotal = Math.min(Number.MAX_SAFE_INTEGER, this.denialTotal + 1);
    this.lastDenialReason = key;
    this.lastDenialAt = Date.now();
    return { runnable: false, reason, resourceMode: "low" };
  }
  private state: SchedulerState = {
    processingMode: "manual",
    gameActive: false,
    pressure: initialPressure(),
    realtimePressureHigh: false,
  };

  update(update: Partial<SchedulerState>): void {
    this.state = { ...this.state, ...update };
    if (this.activeCompute && !this.activeCompute.manualRequest) {
      const reason = this.state.realtimePressureHigh
        ? "realtime_pressure"
        : this.state.pressure.recordingActive
          ? "recording_priority"
          : this.state.processingMode === "manual"
            ? "manual_only"
            : this.state.gameActive && this.state.processingMode === "after_game"
              ? "waiting_for_game_to_finish"
              : undefined;
      if (reason && !this.activeCompute.controller.signal.aborted) {
        this.activeCompute.stoppingReason = reason;
        this.recordComputeEvent(this.activeCompute, "stopping", reason);
        this.activeCompute.controller.abort();
      }
    }
  }

  aiDecision(kind: AiTaskKind, manualRequest: boolean): ScheduledAiDecision {
    if (this.state.realtimePressureHigh && !manualRequest) {
      return this.denied(this.state.pressureReason ?? "realtime_pressure");
    }
    if (this.state.processingMode === "manual" && !manualRequest) return this.denied("manual_only");
    if (this.state.pressure.recordingActive && !manualRequest)
      return this.denied("recording_priority");
    if (this.state.gameActive && this.state.processingMode === "after_game" && !manualRequest) {
      return this.denied("waiting_for_game_to_finish");
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
        this.state.pressure.recordingActive ||
        realtimeFeatureActive ||
        (organizing && this.state.pressure.rendererMemoryPressure) ||
        this.availableMemoryBytes() < 2 * 1024 ** 3
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
    if (this.isManualTextComputeActive()) return { release: false };
    if (this.state.pressure.peerRecovering) return { release: true, reason: "peer_recovery" };
    if (this.state.realtimePressureHigh)
      return { release: true, reason: this.state.pressureReason ?? "realtime_pressure" };
    if (this.state.pressure.recordingActive) return { release: true, reason: "recording_priority" };
    if (this.state.gameActive && this.state.processingMode === "after_game")
      return { release: true, reason: "processing_deferred" };
    return { release: false };
  }
}
