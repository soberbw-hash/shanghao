/** In-memory mono PCM history. The caller must enforce consent before supplying samples. */
export class VoiceReplayBuffer {
  private readonly samples: Float32Array;
  private writeOffset = 0;
  private validSamples = 0;

  constructor(
    readonly sampleRate: number,
    seconds = 60,
  ) {
    if (
      !Number.isInteger(sampleRate) ||
      sampleRate < 1 ||
      sampleRate > 192_000 ||
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 60
    ) {
      throw new RangeError("invalid_voice_replay_capacity");
    }
    this.samples = new Float32Array(sampleRate * seconds);
  }

  append(input: Float32Array): void {
    const bounded = input.subarray(Math.max(0, input.length - this.samples.length));
    const firstLength = Math.min(bounded.length, this.samples.length - this.writeOffset);
    this.samples.set(bounded.subarray(0, firstLength), this.writeOffset);
    this.samples.set(bounded.subarray(firstLength), 0);
    this.writeOffset = (this.writeOffset + bounded.length) % this.samples.length;
    this.validSamples = Math.min(this.samples.length, this.validSamples + bounded.length);
  }

  snapshot(seconds: number): Float32Array {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 60)
      throw new RangeError("invalid_voice_replay_duration");
    const length = Math.min(this.validSamples, Math.floor(seconds * this.sampleRate));
    const result = new Float32Array(length);
    const start = (this.writeOffset - length + this.samples.length) % this.samples.length;
    const firstLength = Math.min(length, this.samples.length - start);
    result.set(this.samples.subarray(start, start + firstLength));
    result.set(this.samples.subarray(0, length - firstLength), firstLength);
    return result;
  }

  clear(): void {
    this.samples.fill(0);
    this.writeOffset = 0;
    this.validSamples = 0;
  }
}
