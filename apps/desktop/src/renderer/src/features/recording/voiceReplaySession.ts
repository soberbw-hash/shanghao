import { VoiceReplayBuffer } from "./voiceReplayBuffer";
import { VoiceReplayConsent } from "./voiceReplayConsent";
import { encodeVoiceReplayWave } from "./voiceReplayWave";

/** Room-scoped in-memory replay. Callers must supply authenticated member IDs. */
export class VoiceReplaySession {
  private readonly buffer: VoiceReplayBuffer;
  private readonly consent: VoiceReplayConsent;
  private closed = false;

  constructor(sampleRate: number) {
    this.buffer = new VoiceReplayBuffer(sampleRate);
    this.consent = new VoiceReplayConsent(() => this.buffer.clear());
  }

  updateMembers(memberIds: readonly string[]): number {
    if (this.closed) throw new Error("voice_replay_closed");
    return this.consent.updateMembers(memberIds);
  }

  approve(memberId: string, epoch: number): boolean {
    return !this.closed && this.consent.approve(memberId, epoch);
  }

  revoke(memberId: string, epoch: number): void {
    if (!this.closed) this.consent.revoke(memberId, epoch);
  }

  append(samples: Float32Array): void {
    if (!this.closed && this.consent.isEnabled()) this.buffer.append(samples);
  }

  snapshot(seconds: 15 | 30 | 60): Uint8Array {
    if (this.closed || !this.consent.isEnabled()) throw new Error("voice_replay_not_authorized");
    return encodeVoiceReplayWave(this.buffer.snapshot(seconds), this.buffer.sampleRate);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.consent.close();
  }
}
