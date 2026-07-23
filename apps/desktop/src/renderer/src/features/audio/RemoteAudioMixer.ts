import { writeRendererLog } from "../../utils/logger";
import { hasPlayableAudioTrack } from "./remoteAudioTrack";

export { hasPlayableAudioTrack } from "./remoteAudioTrack";

type SinkAwareAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

interface RemoteAudioChannel {
  stream: MediaStream;
  audioTrackId: string;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
}

interface ScheduledRelayChunk {
  source: AudioBufferSourceNode;
  startsAt: number;
  durationMs: number;
}

interface RelayAudioChannel {
  gain: GainNode;
  nextPlaybackTime: number;
  droppedOldChunks: number;
  scheduled: ScheduledRelayChunk[];
}

export interface RemoteAudioMixInput {
  peerId: string;
  stream: MediaStream;
  volume: number;
}

export interface RemoteAudioPlaybackStats {
  queueLength: number;
  queueDurationMs: number;
  droppedOldChunks: number;
}

const RELAY_PLAYBACK_LEAD_SECONDS = 0.08;
const MAX_RELAY_QUEUE_DURATION_MS = 700;
const MAX_RELAY_QUEUE_CHUNKS = 36;

/**
 * Owns one renderer-wide audio graph. Each remote member gets an isolated gain
 * channel, while device routing and dynamics processing happen once downstream.
 */
export class RemoteAudioMixer {
  private context?: SinkAwareAudioContext;
  private masterGain?: GainNode;
  private compressor?: DynamicsCompressorNode;
  private channels = new Map<string, RemoteAudioChannel>();
  private relayChannels = new Map<string, RelayAudioChannel>();
  private isDeafened = false;
  private outputDeviceId?: string;
  private resumeInFlight?: Promise<boolean>;

  private ensureGraph(): SinkAwareAudioContext {
    if (this.context && this.masterGain && this.compressor) return this.context;

    const context = new AudioContext({ latencyHint: "interactive" }) as SinkAwareAudioContext;
    const masterGain = context.createGain();
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -8;
    compressor.knee.value = 8;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    masterGain.connect(compressor);
    compressor.connect(context.destination);

    this.context = context;
    this.masterGain = masterGain;
    this.compressor = compressor;
    masterGain.gain.value = this.isDeafened ? 0 : 1;
    void this.applyOutputDevice();
    return context;
  }

  async unlock(reason = "user-activation"): Promise<boolean> {
    const context = this.ensureGraph();
    if (context.state === "running") return true;
    if (this.resumeInFlight) return this.resumeInFlight;

    this.resumeInFlight = context
      .resume()
      .then(() => {
        const isRunning = context.state === "running";
        void writeRendererLog(
          "audio",
          isRunning ? "info" : "warn",
          "Remote audio playback unlock",
          {
            reason,
            state: context.state,
          },
        );
        return isRunning;
      })
      .catch((error) => {
        void writeRendererLog("audio", "warn", "Remote audio playback unlock failed", {
          reason,
          state: context.state,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      })
      .finally(() => {
        this.resumeInFlight = undefined;
      });
    return this.resumeInFlight;
  }

  sync(inputs: RemoteAudioMixInput[]): void {
    const activePeerIds = new Set(inputs.map((input) => input.peerId));
    for (const [peerId] of this.channels) {
      if (!activePeerIds.has(peerId)) this.removeChannel(peerId);
    }

    for (const input of inputs) {
      if (!hasPlayableAudioTrack(input.stream)) {
        this.removeChannel(input.peerId);
        continue;
      }

      const existing = this.channels.get(input.peerId);
      const audioTrackId = input.stream.getAudioTracks()[0]?.id;
      if (!audioTrackId) {
        this.removeChannel(input.peerId);
        continue;
      }
      if (!existing || existing.audioTrackId !== audioTrackId) {
        this.removeChannel(input.peerId);
        this.clearRelayPeer(input.peerId);
        try {
          const context = this.ensureGraph();
          const source = context.createMediaStreamSource(input.stream);
          const gain = context.createGain();
          source.connect(gain);
          gain.connect(this.masterGain!);
          this.channels.set(input.peerId, { stream: input.stream, audioTrackId, source, gain });
        } catch (error) {
          void writeRendererLog("audio", "error", "Failed to add remote stream to audio mixer", {
            peerId: input.peerId,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      const channel = this.channels.get(input.peerId);
      const context = this.context;
      if (channel && context) {
        channel.gain.gain.setTargetAtTime(
          Math.max(0, Math.min(2, input.volume)),
          context.currentTime,
          0.012,
        );
      }
    }

    if (this.channels.size > 0) void this.unlock("remote-stream-sync");
  }

  setDeafened(isDeafened: boolean): void {
    this.isDeafened = isDeafened;
    if (!this.context || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(isDeafened ? 0 : 1, this.context.currentTime, 0.012);
  }

  setOutputDevice(outputDeviceId?: string): void {
    this.outputDeviceId = outputDeviceId;
    void this.applyOutputDevice();
  }

  playRelaySamples(
    peerId: string,
    samples: Float32Array,
    sampleRate: number,
    durationMs: number,
    volume: number,
  ): RemoteAudioPlaybackStats {
    const context = this.ensureGraph();
    const channel = this.getOrCreateRelayChannel(peerId, context);
    const now = context.currentTime;
    this.pruneRelayChannel(channel, now);
    channel.gain.gain.setTargetAtTime(Math.max(0, Math.min(2, volume)), context.currentTime, 0.012);

    if (channel.nextPlaybackTime < now) {
      channel.nextPlaybackTime = now + RELAY_PLAYBACK_LEAD_SECONDS;
    }
    if (channel.nextPlaybackTime - now > MAX_RELAY_QUEUE_DURATION_MS / 1_000) {
      this.resetRelayQueue(channel, context);
    }

    const incomingDurationMs =
      durationMs > 0 ? durationMs : (samples.length / Math.max(1, sampleRate)) * 1_000;
    while (
      channel.scheduled.length >= MAX_RELAY_QUEUE_CHUNKS ||
      Math.max(0, channel.nextPlaybackTime - now) * 1_000 + incomingDurationMs >
        MAX_RELAY_QUEUE_DURATION_MS
    ) {
      if (!this.dropOldestRelayChunk(channel)) break;
    }
    if (channel.scheduled.length === 0) {
      channel.nextPlaybackTime = context.currentTime + RELAY_PLAYBACK_LEAD_SECONDS;
    }

    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(channel.gain);
    const scheduledChunk: ScheduledRelayChunk = {
      source,
      startsAt: channel.nextPlaybackTime,
      durationMs: buffer.duration * 1_000,
    };
    source.onended = () => {
      source.disconnect();
      const index = channel.scheduled.indexOf(scheduledChunk);
      if (index >= 0) channel.scheduled.splice(index, 1);
    };
    source.start(channel.nextPlaybackTime);
    channel.scheduled.push(scheduledChunk);
    channel.nextPlaybackTime += buffer.duration;
    return this.getRelayStats(channel, context.currentTime);
  }

  clearRelayPeer(peerId: string): void {
    const channel = this.relayChannels.get(peerId);
    if (!channel || !this.context) return;
    this.resetRelayQueue(channel, this.context);
  }

  removeRelayPeer(peerId: string): void {
    const channel = this.relayChannels.get(peerId);
    if (!channel) return;
    if (this.context) this.resetRelayQueue(channel, this.context);
    channel.gain.disconnect();
    this.relayChannels.delete(peerId);
  }

  destroy(): void {
    for (const [peerId] of this.channels) this.removeChannel(peerId);
    for (const [peerId] of this.relayChannels) this.removeRelayPeer(peerId);
    this.masterGain?.disconnect();
    this.compressor?.disconnect();
    const context = this.context;
    this.context = undefined;
    this.masterGain = undefined;
    this.compressor = undefined;
    this.resumeInFlight = undefined;
    void context?.close().catch(() => undefined);
  }

  private removeChannel(peerId: string): void {
    const channel = this.channels.get(peerId);
    if (!channel) return;
    channel.source.disconnect();
    channel.gain.disconnect();
    this.channels.delete(peerId);
  }

  private getOrCreateRelayChannel(
    peerId: string,
    context: SinkAwareAudioContext,
  ): RelayAudioChannel {
    const existing = this.relayChannels.get(peerId);
    if (existing) return existing;
    const gain = context.createGain();
    gain.connect(this.masterGain!);
    const created: RelayAudioChannel = {
      gain,
      nextPlaybackTime: context.currentTime + RELAY_PLAYBACK_LEAD_SECONDS,
      droppedOldChunks: 0,
      scheduled: [],
    };
    this.relayChannels.set(peerId, created);
    return created;
  }

  private pruneRelayChannel(channel: RelayAudioChannel, now: number): void {
    while (channel.scheduled[0]) {
      const first = channel.scheduled[0];
      if (first.startsAt + first.durationMs / 1_000 > now) break;
      first.source.disconnect();
      channel.scheduled.shift();
    }
  }

  private dropOldestRelayChunk(channel: RelayAudioChannel): boolean {
    const oldest = channel.scheduled.shift();
    if (!oldest) return false;
    oldest.source.onended = null;
    try {
      oldest.source.stop();
    } catch {
      // The source may already have finished between queue inspection and cleanup.
    }
    oldest.source.disconnect();
    channel.droppedOldChunks += 1;
    return true;
  }

  private resetRelayQueue(channel: RelayAudioChannel, context: SinkAwareAudioContext): void {
    for (const chunk of channel.scheduled.splice(0)) {
      chunk.source.onended = null;
      try {
        chunk.source.stop();
      } catch {
        // Already stopped.
      }
      chunk.source.disconnect();
    }
    channel.nextPlaybackTime = context.currentTime + RELAY_PLAYBACK_LEAD_SECONDS;
  }

  private getRelayStats(channel: RelayAudioChannel, now: number): RemoteAudioPlaybackStats {
    return {
      queueLength: channel.scheduled.length,
      queueDurationMs: Math.max(0, channel.nextPlaybackTime - now) * 1_000,
      droppedOldChunks: channel.droppedOldChunks,
    };
  }

  private async applyOutputDevice(): Promise<void> {
    const context = this.context;
    if (!context?.setSinkId) return;
    try {
      await context.setSinkId(this.outputDeviceId || "default");
    } catch (error) {
      void writeRendererLog("audio", "warn", "Failed to route shared audio mixer output", {
        outputDeviceId: this.outputDeviceId || "default",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

let sharedRemoteAudioMixer: RemoteAudioMixer | undefined;

export const getRemoteAudioMixer = (): RemoteAudioMixer => {
  sharedRemoteAudioMixer ??= new RemoteAudioMixer();
  return sharedRemoteAudioMixer;
};
