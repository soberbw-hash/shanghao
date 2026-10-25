export interface ApplicationAudioPcm {
  sequence: number;
  frames: number;
  channels: 1 | 2;
  sampleRate: 48_000;
  format: "s16le";
  data: Uint8Array;
}

/** A pipe may split a sample or combine several packets. Never trust its lengths. */
export class ApplicationAudioFrameParser {
  private pending = Buffer.alloc(0);

  push(chunk: Buffer): ApplicationAudioPcm[] {
    if (chunk.length > 1024 * 1024) throw new Error("invalid_audio_frame");
    this.pending = Buffer.concat([this.pending, chunk]);
    const frames: ApplicationAudioPcm[] = [];
    while (this.pending.length >= 24) {
      const p = this.pending;
      const channels = p.readUInt16LE(6);
      const count = p.readUInt32LE(12);
      const size = p.readUInt32LE(20);
      if (
        p.toString("ascii", 0, 4) !== "SHAU" ||
        p.readUInt16LE(4) !== 1 ||
        ![1, 2].includes(channels) ||
        p.readUInt32LE(8) !== 48_000 ||
        count === 0 ||
        count > 960 ||
        size !== count * channels * 2
      )
        throw new Error("invalid_audio_frame");
      if (p.length < 24 + size) break;
      frames.push({
        sequence: p.readUInt32LE(16),
        frames: count,
        channels: channels as 1 | 2,
        sampleRate: 48_000,
        format: "s16le",
        data: new Uint8Array(p.subarray(24, 24 + size)),
      });
      this.pending = p.subarray(24 + size);
    }
    return frames;
  }
}
