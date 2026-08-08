export interface RelayVoiceActivityGateDiagnostics {
  isOpen: boolean;
  noiseFloorDb: number;
  openThresholdDb: number;
  lastLevelDb: number;
  suppressedFrames: number;
  openedCount: number;
}

export interface RelayVoiceActivityGateResult {
  samples?: Float32Array;
  opened: boolean;
  closed: boolean;
}

interface BufferedFrame {
  samples: Float32Array;
  durationMs: number;
}

const PRE_ROLL_MS = 120;
const HANGOVER_MS = 260;
const MIN_OPEN_FRAMES = 2;
const MIN_OPEN_THRESHOLD_DB = -48;
const MAX_OPEN_THRESHOLD_DB = -34;
const OPEN_MARGIN_DB = 10;
const CLOSE_HYSTERESIS_DB = 4;
const MIN_DB = -96;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const calculateLevel = (samples: Float32Array): { db: number; crestFactor: number } => {
  let sumSquares = 0;
  let peak = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    sumSquares += sample * sample;
    peak = Math.max(peak, absolute);
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  return {
    db: rms > 0 ? 20 * Math.log10(rms) : MIN_DB,
    crestFactor: peak / Math.max(rms, 0.000_001),
  };
};

const concatenateFrames = (frames: BufferedFrame[]): Float32Array => {
  const totalLength = frames.reduce((total, frame) => total + frame.samples.length, 0);
  const output = new Float32Array(totalLength);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame.samples, offset);
    offset += frame.samples.length;
  }
  return output;
};

/**
 * Lightweight activity gate for the signaling-only emergency audio path.
 * WebRTC and local microphone processing remain untouched.
 */
export class RelayVoiceActivityGate {
  private noiseFloorDb = -62;
  private lastLevelDb = MIN_DB;
  private isOpen = false;
  private activeFrames = 0;
  private hangoverRemainingMs = 0;
  private readonly preRoll: BufferedFrame[] = [];
  private preRollDurationMs = 0;
  private suppressedFrames = 0;
  private openedCount = 0;

  process(input: Float32Array, durationMs: number): RelayVoiceActivityGateResult {
    if (input.length === 0) {
      return { opened: false, closed: false };
    }

    const { db, crestFactor } = calculateLevel(input);
    this.lastLevelDb = db;
    const openThresholdDb = this.getOpenThresholdDb();
    const closeThresholdDb = openThresholdDb - CLOSE_HYSTERESIS_DB;
    // A single high-crest frame is normally a key click or desk impact. Requiring
    // two consecutive frames also prevents short transients from opening the gate.
    const likelyTransient = crestFactor > 8 && db < openThresholdDb + 8;
    const voiceCandidate = db >= openThresholdDb && !likelyTransient;

    if (!this.isOpen) {
      this.pushPreRoll(input, durationMs);
      if (voiceCandidate) {
        this.activeFrames += 1;
      } else {
        this.activeFrames = 0;
        this.updateNoiseFloor(db);
      }

      if (this.activeFrames < MIN_OPEN_FRAMES) {
        this.suppressedFrames += 1;
        return { opened: false, closed: false };
      }

      this.isOpen = true;
      this.openedCount += 1;
      this.hangoverRemainingMs = HANGOVER_MS;
      this.activeFrames = 0;
      const samples = concatenateFrames(this.preRoll);
      this.clearPreRoll();
      return { samples, opened: true, closed: false };
    }

    if (db >= closeThresholdDb && !likelyTransient) {
      this.hangoverRemainingMs = HANGOVER_MS;
    } else {
      this.hangoverRemainingMs -= durationMs;
    }

    const closed = this.hangoverRemainingMs <= 0;
    if (closed) {
      this.isOpen = false;
      this.hangoverRemainingMs = 0;
      this.activeFrames = 0;
    }
    return { samples: new Float32Array(input), opened: false, closed };
  }

  reset(): void {
    this.isOpen = false;
    this.activeFrames = 0;
    this.hangoverRemainingMs = 0;
    this.clearPreRoll();
  }

  getDiagnostics(): RelayVoiceActivityGateDiagnostics {
    return {
      isOpen: this.isOpen,
      noiseFloorDb: this.noiseFloorDb,
      openThresholdDb: this.getOpenThresholdDb(),
      lastLevelDb: this.lastLevelDb,
      suppressedFrames: this.suppressedFrames,
      openedCount: this.openedCount,
    };
  }

  private getOpenThresholdDb(): number {
    return clamp(this.noiseFloorDb + OPEN_MARGIN_DB, MIN_OPEN_THRESHOLD_DB, MAX_OPEN_THRESHOLD_DB);
  }

  private updateNoiseFloor(levelDb: number): void {
    if (levelDb <= MIN_DB || levelDb > this.getOpenThresholdDb() + 3) {
      return;
    }
    const rate = levelDb > this.noiseFloorDb ? 0.025 : 0.08;
    this.noiseFloorDb = clamp(this.noiseFloorDb * (1 - rate) + levelDb * rate, -78, -38);
  }

  private pushPreRoll(input: Float32Array, durationMs: number): void {
    this.preRoll.push({ samples: new Float32Array(input), durationMs });
    this.preRollDurationMs += durationMs;
    while (this.preRollDurationMs > PRE_ROLL_MS && this.preRoll.length > 1) {
      const removed = this.preRoll.shift();
      this.preRollDurationMs -= removed?.durationMs ?? 0;
    }
  }

  private clearPreRoll(): void {
    this.preRoll.length = 0;
    this.preRollDurationMs = 0;
  }
}
