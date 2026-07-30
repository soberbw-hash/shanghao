import { writeRendererLog } from "../../utils/logger";
import { clampMemberVolume } from "./memberVolume";
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
  analyser: AnalyserNode;
  sampleBuffer: Float32Array<ArrayBuffer>;
  volume: number;
}

interface ScheduledRelayChunk {
  source: AudioBufferSourceNode;
  startsAt: number;
  durationMs: number;
}

interface RelayAudioChannel {
  gain: GainNode;
  analyser: AnalyserNode;
  sampleBuffer: Float32Array<ArrayBuffer>;
  nextPlaybackTime: number;
  droppedOldChunks: number;
  scheduled: ScheduledRelayChunk[];
  volume: number;
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

export interface RemoteAudioMixerDiagnostics {
  contextState: AudioContextState | "not_started";
  isDeafened: boolean;
  outputDeviceId: string;
  peers: Record<
    string,
    {
      selectedPath: "webrtc" | "relay";
      hasWebRtcTrack: boolean;
      hasRelayChannel: boolean;
      relayQueueLength: number;
      relayQueueDurationMs: number;
      droppedRelayChunks: number;
      volume: number;
    }
  >;
}

const RELAY_PLAYBACK_LEAD_SECONDS = 0.08;
const MAX_RELAY_QUEUE_DURATION_MS = 700;
const MAX_RELAY_QUEUE_CHUNKS = 36;
const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 66;
const PLAYBACK_WATCHDOG_INTERVAL_MS = 2_000;
export const REMOTE_AUDIO_LEVEL_EVENT = "shanghao:remote-audio-level";

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
  private peerMediaPaths = new Map<string, "webrtc" | "relay">();
  private isDeafened = false;
  private outputDeviceId?: string;
  private resumeInFlight?: Promise<boolean>;
  private audioLevelTimer?: number;
  private playbackWatchdogTimer?: number;
  private readonly smoothedPeerLevels = new Map<string, number>();

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
    context.onstatechange = () => {
      void writeRendererLog(
        "audio",
        context.state === "running" ? "info" : "warn",
        "Shared audio mixer state changed",
        {
          state: context.state,
          webrtcChannelCount: this.channels.size,
          relayChannelCount: this.relayChannels.size,
        },
      );
    };
    this.startMaintenanceTimers();
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
        try {
          const context = this.ensureGraph();
          const source = context.createMediaStreamSource(input.stream);
          const gain = context.createGain();
          const analyser = this.createAnalyser(context);
          source.connect(gain);
          gain.connect(analyser);
          analyser.connect(this.masterGain!);
          this.channels.set(input.peerId, {
            stream: input.stream,
            audioTrackId,
            source,
            gain,
            analyser,
            sampleBuffer: new Float32Array(analyser.fftSize),
            volume: input.volume,
          });
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
        channel.volume = input.volume;
        channel.gain.gain.setTargetAtTime(
          this.peerMediaPaths.get(input.peerId) === "webrtc" ? clampMemberVolume(input.volume) : 0,
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

  getDiagnostics(): RemoteAudioMixerDiagnostics {
    const peerIds = new Set([
      ...this.channels.keys(),
      ...this.relayChannels.keys(),
      ...this.peerMediaPaths.keys(),
    ]);
    const now = this.context?.currentTime ?? 0;
    return {
      contextState: this.context?.state ?? "not_started",
      isDeafened: this.isDeafened,
      outputDeviceId: this.outputDeviceId || "default",
      peers: Object.fromEntries(
        [...peerIds].map((peerId) => {
          const webRtcChannel = this.channels.get(peerId);
          const relayChannel = this.relayChannels.get(peerId);
          const relayStats = relayChannel
            ? this.getRelayStats(relayChannel, now)
            : { queueLength: 0, queueDurationMs: 0, droppedOldChunks: 0 };
          return [
            peerId,
            {
              selectedPath: this.peerMediaPaths.get(peerId) ?? "relay",
              hasWebRtcTrack: Boolean(webRtcChannel),
              hasRelayChannel: Boolean(relayChannel),
              relayQueueLength: relayStats.queueLength,
              relayQueueDurationMs: Math.round(relayStats.queueDurationMs),
              droppedRelayChunks: relayStats.droppedOldChunks,
              volume: webRtcChannel?.volume ?? relayChannel?.volume ?? 1,
            },
          ];
        }),
      ),
    };
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
    channel.volume = volume;
    channel.gain.gain.setTargetAtTime(
      this.peerMediaPaths.get(peerId) === "webrtc" ? 0 : clampMemberVolume(volume),
      context.currentTime,
      0.012,
    );

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

  setPeerMediaPath(peerId: string, path: "webrtc" | "relay"): void {
    this.peerMediaPaths.set(peerId, path);
    const context = this.context;
    if (!context) return;

    const webrtcChannel = this.channels.get(peerId);
    if (webrtcChannel) {
      webrtcChannel.gain.gain.setTargetAtTime(
        path === "webrtc" ? clampMemberVolume(webrtcChannel.volume) : 0,
        context.currentTime,
        0.018,
      );
    }
    const relayChannel = this.relayChannels.get(peerId);
    if (relayChannel) {
      relayChannel.gain.gain.setTargetAtTime(
        path === "relay" ? clampMemberVolume(relayChannel.volume) : 0,
        context.currentTime,
        0.018,
      );
      if (path === "webrtc") {
        this.resetRelayQueue(relayChannel, context);
      }
    }
  }

  forgetPeerMediaPath(peerId: string): void {
    this.peerMediaPaths.delete(peerId);
  }

  removeRelayPeer(peerId: string): void {
    const channel = this.relayChannels.get(peerId);
    if (!channel) return;
    if (this.context) this.resetRelayQueue(channel, this.context);
    channel.gain.disconnect();
    channel.analyser.disconnect();
    this.relayChannels.delete(peerId);
    if (!this.channels.has(peerId)) this.publishPeerLevel(peerId, 0, true);
  }

  destroy(): void {
    for (const [peerId] of this.channels) this.removeChannel(peerId);
    for (const [peerId] of this.relayChannels) this.removeRelayPeer(peerId);
    this.masterGain?.disconnect();
    this.compressor?.disconnect();
    this.stopMaintenanceTimers();
    const context = this.context;
    this.context = undefined;
    this.masterGain = undefined;
    this.compressor = undefined;
    this.resumeInFlight = undefined;
    this.peerMediaPaths.clear();
    this.smoothedPeerLevels.clear();
    void context?.close().catch(() => undefined);
  }

  private removeChannel(peerId: string): void {
    const channel = this.channels.get(peerId);
    if (!channel) return;
    channel.source.disconnect();
    channel.gain.disconnect();
    channel.analyser.disconnect();
    this.channels.delete(peerId);
    if (!this.relayChannels.has(peerId)) this.publishPeerLevel(peerId, 0, true);
  }

  private getOrCreateRelayChannel(
    peerId: string,
    context: SinkAwareAudioContext,
  ): RelayAudioChannel {
    const existing = this.relayChannels.get(peerId);
    if (existing) return existing;
    const gain = context.createGain();
    const analyser = this.createAnalyser(context);
    gain.connect(analyser);
    analyser.connect(this.masterGain!);
    const created: RelayAudioChannel = {
      gain,
      analyser,
      sampleBuffer: new Float32Array(analyser.fftSize),
      nextPlaybackTime: context.currentTime + RELAY_PLAYBACK_LEAD_SECONDS,
      droppedOldChunks: 0,
      scheduled: [],
      volume: 1,
    };
    this.relayChannels.set(peerId, created);
    return created;
  }

  private createAnalyser(context: BaseAudioContext): AnalyserNode {
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.55;
    return analyser;
  }

  private startMaintenanceTimers(): void {
    if (!this.audioLevelTimer) {
      this.audioLevelTimer = window.setInterval(
        () => this.samplePeerLevels(),
        AUDIO_LEVEL_SAMPLE_INTERVAL_MS,
      );
    }
    if (!this.playbackWatchdogTimer) {
      this.playbackWatchdogTimer = window.setInterval(() => {
        if (
          this.context &&
          this.context.state !== "running" &&
          (this.channels.size > 0 || this.relayChannels.size > 0)
        ) {
          void this.unlock("playback-watchdog");
        }
      }, PLAYBACK_WATCHDOG_INTERVAL_MS);
    }
  }

  private stopMaintenanceTimers(): void {
    if (this.audioLevelTimer) {
      window.clearInterval(this.audioLevelTimer);
      this.audioLevelTimer = undefined;
    }
    if (this.playbackWatchdogTimer) {
      window.clearInterval(this.playbackWatchdogTimer);
      this.playbackWatchdogTimer = undefined;
    }
  }

  private samplePeerLevels(): void {
    const peerIds = new Set([...this.channels.keys(), ...this.relayChannels.keys()]);
    for (const peerId of peerIds) {
      const path = this.peerMediaPaths.get(peerId) ?? "relay";
      const channel =
        path === "webrtc" ? this.channels.get(peerId) : this.relayChannels.get(peerId);
      if (!channel) {
        this.publishPeerLevel(peerId, 0);
        continue;
      }
      channel.analyser.getFloatTimeDomainData(channel.sampleBuffer);
      let energy = 0;
      for (const sample of channel.sampleBuffer) energy += sample * sample;
      const rms = Math.sqrt(energy / Math.max(1, channel.sampleBuffer.length));
      const normalized = Math.min(1, rms * 5.2);
      this.publishPeerLevel(peerId, normalized);
    }
  }

  private publishPeerLevel(peerId: string, nextLevel: number, force = false): void {
    const previous = this.smoothedPeerLevels.get(peerId) ?? 0;
    const smoothing = nextLevel > previous ? 0.52 : 0.14;
    const smoothed =
      nextLevel < 0.002 ? previous * 0.72 : previous + (nextLevel - previous) * smoothing;
    const level = smoothed < 0.004 ? 0 : Math.max(0, Math.min(1, smoothed));
    if (!force && Math.abs(level - previous) < 0.004) return;
    if (level === 0 && force) this.smoothedPeerLevels.delete(peerId);
    else this.smoothedPeerLevels.set(peerId, level);
    window.dispatchEvent(
      new CustomEvent(REMOTE_AUDIO_LEVEL_EVENT, {
        detail: { peerId, level },
      }),
    );
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
