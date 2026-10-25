interface CapturedFrame {
  samples: Float32Array;
  rate: number;
  capturedAt: number;
}
const MAX_AGE_MS = 160;
const MAX_BUFFER_MS = 120;

/** Pace by captured samples, not callback arrival time; retain brief IPC delays, discard stale audio. */
export class RelayCapturePump {
  private frames: CapturedFrame[] = [];
  private pendingMs = 0;
  private sending = false;
  private sendStartedAt = 0;
  private generation = 0;
  droppedFrames = 0;

  constructor(
    private readonly send: (
      samples: Float32Array,
      rate: number,
      capturedAt: number,
    ) => Promise<void>,
    private readonly now = () => performance.now(),
  ) {}

  push(samples: Float32Array, rate: number, capturedAt = this.now()): void {
    if (this.sending && this.now() - this.sendStartedAt > 500) {
      this.droppedFrames += this.frames.length + 1;
      this.reset();
    }
    if (!samples.length || !Number.isFinite(rate) || rate <= 0 || !Number.isFinite(capturedAt))
      return;
    if (this.now() - capturedAt > MAX_AGE_MS) {
      this.droppedFrames++;
      return;
    }
    if (this.frames[0] && this.frames[0].rate !== rate) this.reset();
    this.frames.push({ samples: new Float32Array(samples), rate, capturedAt });
    this.pendingMs += (samples.length / rate) * 1000;
    this.trim();
    void this.flush();
  }

  reset(): void {
    this.frames = [];
    this.pendingMs = 0;
    this.generation++;
    this.sending = false;
  }

  private trim(): void {
    while (
      this.frames.length &&
      (this.pendingMs > MAX_BUFFER_MS || this.now() - this.frames[0]!.capturedAt > MAX_AGE_MS)
    ) {
      const discarded = this.frames.shift()!;
      this.pendingMs -= (discarded.samples.length / discarded.rate) * 1000;
      this.droppedFrames++;
    }
  }

  private async flush(): Promise<void> {
    if (this.sending) return;
    this.trim();
    if (this.pendingMs < 20 || !this.frames.length) return;
    const generation = this.generation,
      rate = this.frames[0]!.rate;
    const capturedAt = this.frames[0]!.capturedAt,
      selected: CapturedFrame[] = [];
    let duration = 0,
      length = 0;
    while (duration < 20 && this.frames.length) {
      const frame = this.frames.shift()!;
      selected.push(frame);
      duration += (frame.samples.length / rate) * 1000;
      length += frame.samples.length;
    }
    this.pendingMs = Math.max(0, this.pendingMs - duration);
    const samples = new Float32Array(length);
    let offset = 0;
    for (const frame of selected) {
      samples.set(frame.samples, offset);
      offset += frame.samples.length;
    }
    this.sending = true;
    this.sendStartedAt = this.now();
    try {
      await this.send(samples, rate, capturedAt);
    } catch {
      this.droppedFrames += selected.length;
    } finally {
      if (generation === this.generation) {
        this.sending = false;
        void this.flush();
      }
    }
  }
}
