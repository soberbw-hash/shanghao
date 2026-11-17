import { VoiceReplayBuffer } from "./voiceReplayBuffer";
import { encodeVoiceReplayWave } from "./voiceReplayWave";

/** Locally enabled, room-scoped in-memory replay. */
export class VoiceReplaySession {
  private readonly buffer: VoiceReplayBuffer;
  private closed = false;

  constructor(sampleRate: number) {
    this.buffer = new VoiceReplayBuffer(sampleRate);
  }

  append(samples: Float32Array): void {
    if (!this.closed) this.buffer.append(samples);
  }

  snapshot(seconds: 15 | 30 | 60): Uint8Array {
    if (this.closed) throw new Error("voice_replay_closed");
    return encodeVoiceReplayWave(this.buffer.snapshot(seconds), this.buffer.sampleRate);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.buffer.clear();
  }
}
