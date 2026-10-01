export type ResourceWorkKind =
  | "runtime-preparation"
  | "model-verification"
  | "asr-conversion"
  | "recording-export"
  | "recording-probe"
  | "recording-cleanup";
export interface ResourceWorkLease {
  signal: AbortSignal;
  release(): void;
}

interface Waiter {
  kind: ResourceWorkKind;
  signal?: AbortSignal;
  abort(): void;
  timer: NodeJS.Timeout;
  resolve(lease: ResourceWorkLease): void;
  reject(error: Error): void;
}

const priority = (kind: ResourceWorkKind) =>
  kind === "asr-conversion" ? 2 : kind === "runtime-preparation" ? 1 : 0;

/** CPU/disk work has its own lane: Runtime preparation may run inside an existing GPU lease. */
export class ResourceWorkLane {
  private active?: AbortController;
  private activeKind?: ResourceWorkKind;
  private readonly queue: Waiter[] = [];
  private readonly foreground = new Set<AbortController>();
  private closed = false;
  constructor(
    private readonly waitTimeoutMs = 90_000,
    private readonly executionTimeoutMs = 90 * 60_000,
  ) {}

  acquire(kind: ResourceWorkKind, signal?: AbortSignal): Promise<ResourceWorkLease> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error("ai_task_paused"));
    // Saving a user's recording must not wait behind a lengthy installation or scan.
    // It uses one encoder thread; background scans stop and other heavy work stays serialized.
    if (kind === "recording-export" || kind === "recording-probe") {
      if (this.foreground.size >= 4)
        return Promise.reject(new Error("recording_export_queue_full"));
      if (kind === "recording-export" && this.activeKind === "recording-cleanup")
        this.active?.abort();
      return Promise.resolve(this.grant(kind, signal, true));
    }
    if (!this.active && !this.foreground.size) return Promise.resolve(this.grant(kind, signal));
    if (this.queue.length >= 32) return Promise.reject(new Error("background_resource_queue_full"));
    return new Promise((resolve, reject) => {
      const cancel = (reason: string) => {
        const index = this.queue.indexOf(waiter);
        if (index < 0) return;
        this.queue.splice(index, 1);
        this.detach(waiter);
        reject(new Error(reason));
      };
      const waiter: Waiter = {
        kind,
        signal,
        resolve,
        reject,
        abort: () => cancel("ai_task_paused"),
        timer: setTimeout(() => cancel("background_resource_wait_timeout"), this.waitTimeoutMs),
      };
      const index = this.queue.findIndex((entry) => priority(entry.kind) < priority(kind));
      this.queue.splice(index < 0 ? this.queue.length : index, 0, waiter);
      signal?.addEventListener("abort", waiter.abort, { once: true });
      if (signal?.aborted) waiter.abort();
    });
  }

  private detach(waiter: Waiter): void {
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener("abort", waiter.abort);
  }

  private grant(
    kind: ResourceWorkKind,
    signal?: AbortSignal,
    foreground = false,
  ): ResourceWorkLease {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    if (foreground) this.foreground.add(controller);
    else {
      this.active = controller;
      this.activeKind = kind;
    }
    const timer = setTimeout(abort, this.executionTimeoutMs);
    let released = false;
    return {
      signal: controller.signal,
      release: () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.foreground.delete(controller);
        if (this.active === controller) {
          this.active = undefined;
          this.activeKind = undefined;
        }
        this.pump();
      },
    };
  }

  private pump(): void {
    if (this.closed || this.active || this.foreground.size) return;
    const next = this.queue.shift();
    if (!next) return;
    this.detach(next);
    next.resolve(this.grant(next.kind, next.signal));
  }

  cancelBackgroundScan(): void {
    if (this.activeKind === "recording-cleanup") this.active?.abort();
  }

  close(): void {
    this.closed = true;
    this.active?.abort();
    for (const controller of this.foreground) controller.abort();
    for (const waiter of this.queue.splice(0)) {
      this.detach(waiter);
      waiter.reject(new Error("ai_task_paused"));
    }
  }
}
