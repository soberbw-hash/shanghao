import {
  displayRefreshRateService,
  type DisplayRefreshRateService,
} from "./DisplayRefreshRateService";

const MAX_VISUAL_TASKS = 256;
const MAX_PRELOADED_ASSETS = 32;

export interface VisualFrameContext {
  timestamp: number;
  deltaMs: number;
  refreshRateHz?: number;
  frameBudgetMs: number;
}

export type VisualFrameTask = (frame: VisualFrameContext) => void | boolean;

interface VisualRuntimeEnvironment {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  isVisible: () => boolean;
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
}

const browserEnvironment = (): VisualRuntimeEnvironment => ({
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (id) => window.cancelAnimationFrame(id),
  // Chromium can keep an occluded Electron window "visible" while a game is
  // in the foreground. Purely visual schedulers should stop in that state as
  // well, while voice/network/audio continue outside this controller.
  isVisible: () => document.visibilityState !== "hidden" && document.hasFocus(),
  addVisibilityListener: (listener) => {
    document.addEventListener("visibilitychange", listener);
    window.addEventListener("focus", listener);
    window.addEventListener("blur", listener);
  },
  removeVisibilityListener: (listener) => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
  },
});

export class VisualRuntimeController {
  private readonly tasks = new Map<string, VisualFrameTask>();
  private readonly assetPreloads = new Map<string, Promise<unknown>>();
  private frameId?: number;
  private previousFrameAt?: number;
  private started = false;
  private readonly visibilityListeners = new Set<(visible: boolean) => void>();

  constructor(
    private readonly environment: VisualRuntimeEnvironment = browserEnvironment(),
    private readonly refreshRate: DisplayRefreshRateService = displayRefreshRateService,
  ) {}

  start(): () => void {
    if (!this.started) {
      this.started = true;
      this.environment.addVisibilityListener(this.handleVisibilityChange);
      this.scheduleIfNeeded();
    }
    return () => this.stop();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.environment.removeVisibilityListener(this.handleVisibilityChange);
    this.cancelScheduledFrame();
    this.previousFrameAt = undefined;
  }

  registerTask(id: string, task: VisualFrameTask): () => void {
    if (!this.tasks.has(id) && this.tasks.size >= MAX_VISUAL_TASKS) {
      throw new Error("Visual runtime task capacity exceeded");
    }
    this.tasks.set(id, task);
    this.scheduleIfNeeded();
    return () => {
      if (this.tasks.get(id) === task) this.tasks.delete(id);
      if (this.tasks.size === 0) this.cancelScheduledFrame();
    };
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  preloadAsset<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.assetPreloads.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    if (this.assetPreloads.size >= MAX_PRELOADED_ASSETS) {
      const oldestKey = this.assetPreloads.keys().next().value as string | undefined;
      if (oldestKey) this.assetPreloads.delete(oldestKey);
    }
    const pending = loader().catch((error) => {
      if (this.assetPreloads.get(key) === pending) this.assetPreloads.delete(key);
      throw error;
    });
    this.assetPreloads.set(key, pending);
    return pending;
  }

  getPreloadedAssetCount(): number {
    return this.assetPreloads.size;
  }

  isVisible(): boolean {
    return this.environment.isVisible();
  }

  subscribeVisibility(listener: (visible: boolean) => void): () => void {
    this.visibilityListeners.add(listener);
    listener(this.environment.isVisible());
    return () => this.visibilityListeners.delete(listener);
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameId = undefined;
    if (!this.started || !this.environment.isVisible()) return;

    this.refreshRate.observeWindowEnvironment(timestamp);
    this.refreshRate.observeFrame(timestamp);
    const deltaMs = this.previousFrameAt === undefined ? 0 : timestamp - this.previousFrameAt;
    this.previousFrameAt = timestamp;
    const frame: VisualFrameContext = {
      timestamp,
      deltaMs,
      refreshRateHz: this.refreshRate.getRefreshRateHz(),
      frameBudgetMs: this.refreshRate.getFrameBudgetMs(),
    };

    for (const [id, task] of [...this.tasks]) {
      if (task(frame) === false) this.tasks.delete(id);
    }
    this.scheduleIfNeeded();
  };

  private readonly handleVisibilityChange = (): void => {
    this.previousFrameAt = undefined;
    this.refreshRate.reset();
    const visible = this.environment.isVisible();
    this.visibilityListeners.forEach((listener) => listener(visible));
    if (visible) this.scheduleIfNeeded();
    else this.cancelScheduledFrame();
  };

  private scheduleIfNeeded(): void {
    if (
      this.frameId !== undefined ||
      !this.started ||
      !this.environment.isVisible() ||
      this.tasks.size === 0
    ) {
      return;
    }
    this.frameId = this.environment.requestFrame(this.onFrame);
  }

  private cancelScheduledFrame(): void {
    if (this.frameId !== undefined) this.environment.cancelFrame(this.frameId);
    this.frameId = undefined;
  }
}

export const visualRuntimeController = new VisualRuntimeController();
