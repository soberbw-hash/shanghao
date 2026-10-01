import type { AiRuntimePressure, AiTaskKind } from "@private-voice/shared";
import { freemem } from "node:os";
import { awaitTask } from "./task-cancellation";
import { DownloadBandwidthBudget, backgroundDownloadPolicy } from "./download-bandwidth-budget";
import { hostCapacitySampler, type HostCapacitySampler } from "./host-resource-capacity";
import { ResourceWorkLane, type ResourceWorkKind } from "./resource-work-lane";
import {
  aiResourcePolicy,
  type SchedulerState,
  type ScheduledAiDecision,
} from "./ai-resource-policy";
export type { ScheduledAiDecision } from "./ai-resource-policy";

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
export {
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND,
} from "./download-bandwidth-budget";

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
  timer: NodeJS.Timeout;
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
  private readonly bandwidth = new DownloadBandwidthBudget(() => this.backgroundDownloadDecision());
  private readonly workLane = new ResourceWorkLane();
  private closed = false;
  constructor(
    private readonly availableMemoryBytes = freemem,
    private readonly capacity: Pick<
      HostCapacitySampler,
      "current" | "refresh"
    > = hostCapacitySampler,
    private readonly computeWaitTimeoutMs = 15 * 60_000,
  ) {}

  /** Model and Runtime transfers share one bandwidth budget and pressure decision. */
  consumeDownloadBytes(bytes: number, signal?: AbortSignal): Promise<void> {
    return this.bandwidth.consume(bytes, signal);
  }

  async runWork<T>(
    kind: ResourceWorkKind,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (kind !== "recording-export" && kind !== "recording-probe")
      await awaitTask(this.capacity.refresh(), signal);
    if (
      kind !== "recording-export" &&
      kind !== "recording-probe" &&
      this.availableMemoryBytes() < 512 * 1024 ** 2
    )
      throw new Error("memory_pressure");
    const lease = await this.workLane.acquire(kind, signal);
    try {
      if (lease.signal.aborted) throw new Error("ai_task_paused");
      if (
        kind === "recording-cleanup" &&
        (this.backgroundDownloadDecision().defer ||
          this.state.pressure.recordingActive ||
          (this.capacity.current().cpuBusyRatio ?? 0) > 0.9 ||
          this.availableMemoryBytes() < 1024 ** 3)
      )
        throw new Error("background_resource_pressure");
      const result = await operation(lease.signal);
      if (lease.signal.aborted) throw new Error("ai_task_paused");
      return result;
    } finally {
      lease.release();
    }
  }

  close(): void {
    this.closed = true;
    this.cancelCompute();
    this.workLane.close();
  }
  refreshCapacity(signal?: AbortSignal): Promise<void> {
    return awaitTask(this.capacity.refresh(), signal);
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
    if (this.closed || signal?.aborted) throw new Error("ai_task_paused");
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
        timer: setTimeout(() => {
          const index = this.computeWaiters.indexOf(waiter);
          if (index < 0) return;
          this.computeWaiters.splice(index, 1);
          signal?.removeEventListener("abort", waiter.onAbort);
          this.recordComputeEvent(waiter, "cancelled", "ai_compute_wait_timeout");
          reject(new Error("ai_compute_wait_timeout"));
        }, this.computeWaitTimeoutMs),
        onAbort: () => {
          const index = this.computeWaiters.indexOf(waiter);
          if (index < 0) return;
          this.computeWaiters.splice(index, 1);
          clearTimeout(waiter.timer);
          signal?.removeEventListener("abort", waiter.onAbort);
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
      clearTimeout(waiter.timer);
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
      clearTimeout(waiter.timer);
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
      "cpu_pressure",
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
    if (this.state.pressure.recordingActive || this.backgroundDownloadDecision().defer)
      this.workLane.cancelBackgroundScan();
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
    const decision = aiResourcePolicy(this.state, kind, manualRequest, {
      ...this.capacity.current(),
      availableMemoryBytes: this.availableMemoryBytes(),
    });
    return decision.runnable ? decision : this.denied(decision.reason ?? "resource_pressure");
  }

  downloadBytesPerSecond(): number {
    return backgroundDownloadPolicy(this.state).bytesPerSecond;
  }

  backgroundDownloadDecision(): BackgroundDownloadDecision {
    return backgroundDownloadPolicy(this.state);
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
