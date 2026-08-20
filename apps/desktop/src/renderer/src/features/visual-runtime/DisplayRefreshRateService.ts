const MIN_SAMPLE_COUNT = 12;
const MAX_SAMPLE_COUNT = 120;
const MIN_FRAME_INTERVAL_MS = 3;
const MAX_FRAME_INTERVAL_MS = 50;
const DISPLAY_RATE_CANDIDATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240];
const ENVIRONMENT_SAMPLE_INTERVAL_MS = 500;

export interface DisplayEnvironmentSnapshot {
  width: number;
  height: number;
  availableWidth: number;
  availableHeight: number;
  scaleFactor: number;
}

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
};

const snapToKnownRefreshRate = (measured: number): number => {
  const closest = DISPLAY_RATE_CANDIDATES.reduce((best, candidate) =>
    Math.abs(candidate - measured) < Math.abs(best - measured) ? candidate : best,
  );
  return Math.abs(closest - measured) / closest <= 0.035 ? closest : Math.round(measured);
};

export class DisplayRefreshRateService {
  private intervals: number[] = [];
  private previousFrameAt?: number;
  private refreshRateHz?: number;
  private lastEnvironmentSampleAt = Number.NEGATIVE_INFINITY;
  private environment?: DisplayEnvironmentSnapshot;

  observeFrame(timestamp: number): void {
    if (this.previousFrameAt !== undefined) {
      const interval = timestamp - this.previousFrameAt;
      if (interval > MAX_FRAME_INTERVAL_MS) {
        this.reset(timestamp);
        return;
      }
      if (interval >= MIN_FRAME_INTERVAL_MS) {
        this.intervals.push(interval);
        if (this.intervals.length > MAX_SAMPLE_COUNT) {
          this.intervals.splice(0, this.intervals.length - MAX_SAMPLE_COUNT);
        }
        this.refreshRateHz = this.estimate();
      }
    }
    this.previousFrameAt = timestamp;
  }

  observeWindowEnvironment(timestamp: number): void {
    if (
      typeof window === "undefined" ||
      typeof screen === "undefined" ||
      timestamp - this.lastEnvironmentSampleAt < ENVIRONMENT_SAMPLE_INTERVAL_MS
    ) {
      return;
    }
    this.lastEnvironmentSampleAt = timestamp;
    this.updateEnvironment(
      {
        width: screen.width,
        height: screen.height,
        availableWidth: screen.availWidth,
        availableHeight: screen.availHeight,
        scaleFactor: window.devicePixelRatio || 1,
      },
      timestamp,
    );
  }

  updateEnvironment(snapshot: DisplayEnvironmentSnapshot, timestamp?: number): void {
    const changed =
      this.environment !== undefined &&
      (this.environment.width !== snapshot.width ||
        this.environment.height !== snapshot.height ||
        this.environment.availableWidth !== snapshot.availableWidth ||
        this.environment.availableHeight !== snapshot.availableHeight ||
        this.environment.scaleFactor !== snapshot.scaleFactor);
    this.environment = { ...snapshot };
    if (changed) this.reset(timestamp);
  }

  getEnvironment(): DisplayEnvironmentSnapshot | undefined {
    return this.environment ? { ...this.environment } : undefined;
  }

  reset(nextFrameAt?: number): void {
    this.intervals = [];
    this.refreshRateHz = undefined;
    this.previousFrameAt = nextFrameAt;
  }

  getRefreshRateHz(): number | undefined {
    return this.refreshRateHz;
  }

  getFrameBudgetMs(): number {
    return 1_000 / (this.refreshRateHz ?? 60);
  }

  private estimate(): number | undefined {
    if (this.intervals.length < MIN_SAMPLE_COUNT) return undefined;
    const sorted = [...this.intervals].sort((left, right) => left - right);
    const trim = Math.floor(sorted.length * 0.1);
    const stable = sorted.slice(trim, sorted.length - trim || undefined);
    const frameInterval = median(stable);
    return frameInterval ? snapToKnownRefreshRate(1_000 / frameInterval) : undefined;
  }
}

export const displayRefreshRateService = new DisplayRefreshRateService();
