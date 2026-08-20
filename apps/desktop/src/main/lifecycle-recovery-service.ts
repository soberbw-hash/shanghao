import { powerMonitor, screen } from "electron";

import type { RendererLogPayload } from "@private-voice/shared";

type LifecycleReason =
  | "suspend"
  | "resume"
  | "lock-screen"
  | "unlock-screen"
  | "user-active"
  | "display-added"
  | "display-removed"
  | "display-metrics-changed";

/** Coalesces Windows lifecycle changes into one deterministic application reconciliation pass. */
export class LifecycleRecoveryService {
  private started = false;
  private reconcileTimer: NodeJS.Timeout | undefined;
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly reconcile: (reason: LifecycleReason) => void | Promise<void>,
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    const onSuspend = () => this.schedule("suspend");
    const onResume = () => this.schedule("resume");
    const onLock = () => this.schedule("lock-screen");
    const onUnlock = () => this.schedule("unlock-screen");
    const onUserActive = () => this.schedule("user-active");
    powerMonitor.on("suspend", onSuspend);
    powerMonitor.on("resume", onResume);
    powerMonitor.on("lock-screen", onLock);
    powerMonitor.on("unlock-screen", onUnlock);
    powerMonitor.on("user-did-become-active", onUserActive);
    this.cleanup.push(
      () => powerMonitor.removeListener("suspend", onSuspend),
      () => powerMonitor.removeListener("resume", onResume),
      () => powerMonitor.removeListener("lock-screen", onLock),
      () => powerMonitor.removeListener("unlock-screen", onUnlock),
      () => powerMonitor.removeListener("user-did-become-active", onUserActive),
    );

    const onDisplayAdded = () => this.schedule("display-added");
    const onDisplayRemoved = () => this.schedule("display-removed");
    const onDisplayMetricsChanged = () => this.schedule("display-metrics-changed");
    screen.on("display-added", onDisplayAdded);
    screen.on("display-removed", onDisplayRemoved);
    screen.on("display-metrics-changed", onDisplayMetricsChanged);
    this.cleanup.push(
      () => screen.removeListener("display-added", onDisplayAdded),
      () => screen.removeListener("display-removed", onDisplayRemoved),
      () => screen.removeListener("display-metrics-changed", onDisplayMetricsChanged),
    );
  }

  stop(): void {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = undefined;
    for (const dispose of this.cleanup.splice(0)) dispose();
    this.started = false;
  }

  private schedule(reason: LifecycleReason): void {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.writeLog({
        category: "app",
        level: "info",
        message: "lifecycle_reconcile",
        context: { reason },
      });
      void this.reconcile(reason);
    }, 250);
  }
}
