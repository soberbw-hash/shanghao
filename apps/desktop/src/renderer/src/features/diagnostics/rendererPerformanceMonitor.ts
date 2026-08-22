import type { FramePerformanceSnapshot } from "@private-voice/shared";

import {
  getRenderProfileSnapshot,
  resetRenderProfile,
  setRenderProfilingEnabled,
} from "./renderProfiler";
import { displayRefreshRateService } from "../visual-runtime/DisplayRefreshRateService";
import {
  visualRuntimeController,
  type VisualFrameContext,
} from "../visual-runtime/VisualRuntimeController";

const SAMPLE_WINDOW_MS = 10_000;
const LONG_FRAME_MS = 50;
const MAX_FRAME_SAMPLES = 2_000;

export type LongTaskCategory = "react" | "ipc" | "image-decode" | "js" | "canvas" | "audio";

const percentile = (values: number[], fraction: number): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};

class RendererPerformanceMonitor {
  private frames: Array<{ at: number; duration: number }> = [];
  private longTasks: Array<{ at: number; duration: number; category: LongTaskCategory }> = [];
  private previousFrameAt?: number;
  private observer?: PerformanceObserver;
  private consumers = 0;
  private stopFrameTask?: () => void;

  start(): () => void {
    this.consumers += 1;
    if (this.consumers === 1) {
      this.frames = [];
      this.longTasks = [];
      this.previousFrameAt = undefined;
      resetRenderProfile();
      setRenderProfilingEnabled(true);
      this.stopFrameTask = visualRuntimeController.registerTask(
        "renderer-performance-monitor",
        this.onFrame,
      );
      if (typeof PerformanceObserver !== "undefined") {
        try {
          this.observer = new PerformanceObserver((list) => {
            const now = performance.now();
            for (const entry of list.getEntries()) {
              this.longTasks.push({ at: now, duration: entry.duration, category: "js" });
            }
            this.prune(now);
          });
          this.observer.observe({ type: "longtask", buffered: true });
        } catch {
          this.observer = undefined;
        }
      }
    }

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.consumers = Math.max(0, this.consumers - 1);
      if (this.consumers > 0) return;
      this.stopFrameTask?.();
      this.stopFrameTask = undefined;
      this.previousFrameAt = undefined;
      setRenderProfilingEnabled(false);
      this.observer?.disconnect();
      this.observer = undefined;
    };
  }

  snapshot(): FramePerformanceSnapshot {
    const now = performance.now();
    this.prune(now);
    const durations = this.frames.map((sample) => sample.duration);
    const firstFrame = this.frames[0];
    const lastFrame = this.frames.at(-1);
    const elapsed = firstFrame && lastFrame ? lastFrame.at - firstFrame.at : 0;
    const p95 = percentile(durations, 0.95);
    const p99 = percentile(durations, 0.99);
    const onePercentLowFrameTime = percentile(durations, 0.99);
    const longestTask = this.longTasks.reduce(
      (longest, task) => Math.max(longest, task.duration),
      0,
    );
    const longTaskCategories = this.longTasks.reduce<Partial<Record<LongTaskCategory, number>>>(
      (counts, task) => {
        counts[task.category] = (counts[task.category] ?? 0) + 1;
        return counts;
      },
      {},
    );

    const renderProfile = getRenderProfileSnapshot();
    return {
      displayRefreshRateHz: displayRefreshRateService.getRefreshRateHz(),
      actualFps: elapsed > 0 ? ((this.frames.length - 1) * 1_000) / elapsed : undefined,
      onePercentLowFps:
        onePercentLowFrameTime && onePercentLowFrameTime > 0
          ? 1_000 / onePercentLowFrameTime
          : undefined,
      frameTimeP95Ms: p95,
      frameTimeP99Ms: p99,
      longFrameCount: durations.filter((duration) => duration >= LONG_FRAME_MS).length,
      longTaskCount: this.longTasks.length,
      longestTaskMs: longestTask || undefined,
      sampleWindowMs: SAMPLE_WINDOW_MS,
      componentRenderCounts: renderProfile.counts,
      componentRenderReasons: renderProfile.reasons,
      longTaskCategories,
    };
  }

  recordLongTask(category: LongTaskCategory, duration: number, at = performance.now()): void {
    if (!Number.isFinite(duration) || duration < LONG_FRAME_MS) return;
    this.longTasks.push({ at, duration, category });
    this.prune(at);
  }

  private readonly onFrame = ({ timestamp: at }: VisualFrameContext): void => {
    if (this.previousFrameAt !== undefined) {
      this.frames.push({ at, duration: at - this.previousFrameAt });
      if (this.frames.length > MAX_FRAME_SAMPLES) {
        this.frames.splice(0, this.frames.length - MAX_FRAME_SAMPLES);
      }
    }
    this.previousFrameAt = at;
    this.prune(at);
  };

  private prune(now: number): void {
    const cutoff = now - SAMPLE_WINDOW_MS;
    while (this.frames.length > 0 && (this.frames[0]?.at ?? now) < cutoff) this.frames.shift();
    while (this.longTasks.length > 0 && (this.longTasks[0]?.at ?? now) < cutoff) {
      this.longTasks.shift();
    }
  }
}

export const rendererPerformanceMonitor = new RendererPerformanceMonitor();
