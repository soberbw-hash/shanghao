import { writeRendererLog } from "../../utils/logger";
import { clampMemberVolume } from "./memberVolume";
import {
  advanceLoudnessBalance,
  applyLoudnessBalanceToMemberVolume,
  createLoudnessBalanceState,
  type LoudnessBalanceState,
} from "./loudnessBalance";
import { resolveRemoteAudioPath, type RemoteAudioMediaPath } from "./remoteAudioPathSelection";
import { hasPlayableAudioTrack } from "./remoteAudioTrack";

export { hasPlayableAudioTrack } from "./remoteAudioTrack";

type SinkAwareAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

interface RemoteAudioChannel {
  stream: MediaStream;
  audioTrackId: string;
  decoderPump: HTMLAudioElement;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  sampleBuffer: Float32Array<ArrayBuffer>;
  volume: number;
  hasObservedAudio: boolean;
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
  audioContextCount: number;
  audioNodeCount: number;
  timerCount: number;
  webrtcChannelCount: number;
  relayChannelCount: number;
  isDeafened: boolean;
  masterVolume: number;
  loudnessBalanceEnabled: boolean;
  outputDeviceId: string;
  peers: Record<
    string,
    {
      selectedPath: "webrtc" | "relay";
      hasWebRtcTrack: boolean;
      webRtcTrackMuted: boolean;
      webRtcGraphReady: boolean;
      webRtcPlaybackReady: boolean;
      decoderPumpReady: boolean;
      hasRelayChannel: boolean;
      relayQueueLength: number;
      relayQueueDurationMs: number;
      droppedRelayChunks: number;
      volume: number;
      loudnessGain: number;
      estimatedLufs?: number;
    }
  >;
}

const RELAY_PLAYBACK_LEAD_SECONDS = 0.08;
const MAX_RELAY_QUEUE_DURATION_MS = 700;
const MAX_RELAY_QUEUE_CHUNKS = 36;
const AUDIO_LEVEL_SAMPLE_INTERVAL_MS = 66;
const PLAYBACK_WATCHDOG_INTERVAL_MS = 2_000;
const WEBRTC_AUDIO_PROOF_RMS = 0.0008;
// A newly attached MediaStream can already contain decoded samples before the
// channel volume has been applied. Start silent and ease in the requested level
// so the first remote frame can never escape at the GainNode default of 1.
const REMOTE_AUDIO_GAIN_RAMP_SECONDS = 0.045;
const OUTPUT_LIMITER_THRESHOLD_DB = -1.5;
export const REMOTE_AUDIO_LEVEL_EVENT = "shanghao:remote-audio-level";

/**
 * Owns one renderer-wide audio graph. Each remote member gets an isolated gain
 * channel, while device routing and dynamics processing happen once downstream.
 */
export class RemoteAudioMixer {
  private context?: SinkAwareAudioContext;
  private masterGain?: GainNode;
  private outputLimiter?: DynamicsCompressorNode;
  private finalOutputTap?: MediaStreamAudioDestinationNode;
  private channels = new Map<string, RemoteAudioChannel>();
  private relayChannels = new Map<string, RelayAudioChannel>();
  private peerMediaPaths = new Map<string, RemoteAudioMediaPath>();
  private isDeafened = false;
  private masterVolume = 1;
  private loudnessBalanceEnabled = false;
  private outputDeviceId?: string;
  private resumeInFlight?: Promise<boolean>;
  private audioLevelTimer?: number;
  private playbackWatchdogTimer?: number;
  private readonly smoothedPeerLevels = new Map<string, number>();
  private readonly peerLoudnessStates = new Map<string, LoudnessBalanceState>();

  private ensureGraph(): SinkAwareAudioContext {
    if (this.context && this.masterGain && this.outputLimiter && this.finalOutputTap) {
      return this.context;
    }

    const context = new AudioContext({ latencyHint: "interactive" }) as SinkAwareAudioContext;
    const masterGain = context.createGain();
    const outputLimiter = context.createDynamicsCompressor();
    const finalOutputTap = context.createMediaStreamDestination();
    finalOutputTap.channelCount = 1;
    finalOutputTap.channelCountMode = "explicit";
    // Per-speaker balancing establishes the normal listening level. The shared bus only catches
    // exceptional peaks; it must not pull every speaker down as soon as a second person talks.
    outputLimiter.threshold.value = OUTPUT_LIMITER_THRESHOLD_DB;
    outputLimiter.knee.value = 0;
    outputLimiter.ratio.value = 20;
    outputLimiter.attack.value = 0.003;
    outputLimiter.release.value = 0.16;
    masterGain.connect(outputLimiter);
    outputLimiter.connect(finalOutputTap);
    outputLimiter.connect(context.destination);

    this.context = context;
    this.masterGain = masterGain;
    this.outputLimiter = outputLimiter;
    this.finalOutputTap = finalOutputTap;
    masterGain.gain.value = this.getEffectiveMasterVolume();
    context.onstatechange = () => {
      const peerIds = new Set([
        ...this.channels.keys(),
        ...this.relayChannels.keys(),
        ...this.peerMediaPaths.keys(),
      ]);
      for (const peerId of peerIds) this.refreshPeerGains(peerId);
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
    void this.applyOutputDevice();
    return context;
  }

  async unlock(reason = "user-activation"): Promise<boolean> {
    const context = this.ensureGraph();
    this.resumeDecoderPumps(reason);
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
          gain.gain.setValueAtTime(0, context.currentTime);
          // Observe the decoded WebRTC waveform before the path gain. During
          // relay fallback the WebRTC gain is intentionally zero, but we still
          // need proof that Chromium has started decoding real audio before we
          // retire the audible relay path.
          source.connect(analyser);
          analyser.connect(gain);
          gain.connect(this.masterGain!);
          const decoderPump = this.createDecoderPump(input.peerId, input.stream);
          this.channels.set(input.peerId, {
            stream: input.stream,
            audioTrackId,
            decoderPump,
            source,
            gain,
            analyser,
            sampleBuffer: new Float32Array(analyser.fftSize),
            volume: input.volume,
            hasObservedAudio: false,
          });
          this.startMaintenanceTimers();
          this.refreshPeerGains(input.peerId);
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
        this.refreshPeerGains(input.peerId);
      }
    }

    if (this.channels.size > 0) void this.unlock("remote-stream-sync");
  }

  setDeafened(isDeafened: boolean): void {
    this.isDeafened = isDeafened;
    this.applyMasterVolume();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(2, Number.isFinite(volume) ? volume : 1));
    this.applyMasterVolume();
  }

  setLoudnessBalanceEnabled(enabled: boolean): void {
    if (this.loudnessBalanceEnabled === enabled) return;
    this.loudnessBalanceEnabled = enabled;
    if (!enabled) this.peerLoudnessStates.clear();
    for (const peerId of new Set([...this.channels.keys(), ...this.relayChannels.keys()])) {
      this.refreshPeerGains(peerId);
    }
  }

  /** Final software PCM after per-peer gain, master volume and the peak limiter. */
  getFinalOutputStream(): MediaStream {
    this.ensureGraph();
    return this.finalOutputTap!.stream;
  }

  getRemoteReferenceLevel(): number {
    let combinedSquare = 0;
    for (const level of this.smoothedPeerLevels.values()) combinedSquare += level * level;
    return Math.min(1, Math.sqrt(combinedSquare));
  }

  setOutputDevice(outputDeviceId?: string): Promise<void> {
    this.outputDeviceId = outputDeviceId;
    return this.applyOutputDevice();
  }

  async playTestTone(): Promise<void> {
    const context = this.ensureGraph();
    await this.unlock("speaker-test");
    const oscillator = context.createOscillator();
    const toneGain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, now);
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.14, now + 0.018);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    oscillator.connect(toneGain);
    toneGain.connect(this.masterGain!);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
    oscillator.addEventListener(
      "ended",
      () => {
        oscillator.disconnect();
        toneGain.disconnect();
      },
      { once: true },
    );
  }

  recoverOutputDevice(): void {
    void this.applyOutputDevice();
    void this.unlock("audio-device-change");
  }

  async repairPeerPlayback(peerId: string): Promise<boolean> {
    const channel = this.channels.get(peerId);
    const context = this.context;
    if (!channel || !context || !this.masterGain) return false;
    await this.unlock("targeted-peer-playback-repair");
    channel.source.disconnect();
    channel.analyser.disconnect();
    channel.gain.disconnect();
    channel.gain.gain.cancelScheduledValues(context.currentTime);
    channel.gain.gain.setValueAtTime(0, context.currentTime);
    channel.source.connect(channel.analyser);
    channel.analyser.connect(channel.gain);
    channel.gain.connect(this.masterGain);
    channel.hasObservedAudio = false;
    this.startDecoderPump(peerId, channel.decoderPump, "targeted-peer-playback-repair");
    this.refreshPeerGains(peerId);
    void writeRendererLog("audio", "info", "Repaired one peer playback graph before ICE recovery", {
      peerId,
      contextState: context.state,
      audioTrackId: channel.audioTrackId,
    });
    return true;
  }

  hasWebRtcPlaybackChannel(peerId: string): boolean {
    const channel = this.channels.get(peerId);
    const audioTrack = channel?.stream.getAudioTracks()[0];
    return Boolean(
      channel &&
      this.context?.state === "running" &&
      audioTrack &&
      audioTrack.readyState === "live" &&
      audioTrack.enabled &&
      !audioTrack.muted,
    );
  }

  hasVerifiedWebRtcPlayback(peerId: string): boolean {
    return Boolean(
      this.hasWebRtcPlaybackChannel(peerId) && this.channels.get(peerId)?.hasObservedAudio,
    );
  }

  getEffectivePeerPath(peerId: string): RemoteAudioMediaPath {
    return resolveRemoteAudioPath({
      requestedPath: this.peerMediaPaths.get(peerId),
      hasWebRtcChannel: this.hasWebRtcPlaybackChannel(peerId),
      hasVerifiedWebRtcAudio: this.hasVerifiedWebRtcPlayback(peerId),
      hasRelayChannel: this.relayChannels.has(peerId),
    });
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
      audioContextCount: this.context ? 1 : 0,
      audioNodeCount: (this.context ? 3 : 0) + this.channels.size * 3 + this.relayChannels.size * 2,
      timerCount:
        Number(this.audioLevelTimer !== undefined) +
        Number(this.playbackWatchdogTimer !== undefined),
      webrtcChannelCount: this.channels.size,
      relayChannelCount: this.relayChannels.size,
      isDeafened: this.isDeafened,
      masterVolume: this.masterVolume,
      loudnessBalanceEnabled: this.loudnessBalanceEnabled,
      outputDeviceId: this.outputDeviceId || "default",
      peers: Object.fromEntries(
        [...peerIds].map((peerId) => {
          const webRtcChannel = this.channels.get(peerId);
          const webRtcAudioTrack = webRtcChannel?.stream.getAudioTracks()[0];
          const relayChannel = this.relayChannels.get(peerId);
          const relayStats = relayChannel
            ? this.getRelayStats(relayChannel, now)
            : { queueLength: 0, queueDurationMs: 0, droppedOldChunks: 0 };
          return [
            peerId,
            {
              selectedPath: this.getEffectivePeerPath(peerId),
              hasWebRtcTrack: Boolean(webRtcChannel),
              webRtcTrackMuted: webRtcAudioTrack?.muted ?? true,
              webRtcGraphReady: this.hasWebRtcPlaybackChannel(peerId),
              webRtcPlaybackReady: this.hasVerifiedWebRtcPlayback(peerId),
              decoderPumpReady: Boolean(
                webRtcChannel &&
                !webRtcChannel.decoderPump.paused &&
                webRtcChannel.decoderPump.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,
              ),
              hasRelayChannel: Boolean(relayChannel),
              relayQueueLength: relayStats.queueLength,
              relayQueueDurationMs: Math.round(relayStats.queueDurationMs),
              droppedRelayChunks: relayStats.droppedOldChunks,
              volume: webRtcChannel?.volume ?? relayChannel?.volume ?? 1,
              loudnessGain: this.peerLoudnessStates.get(peerId)?.gain ?? 1,
              estimatedLufs: this.peerLoudnessStates.get(peerId)?.estimatedLufs,
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
    this.refreshPeerGains(peerId);

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
    source.connect(channel.analyser);
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

  setPeerMediaPath(peerId: string, path: RemoteAudioMediaPath): void {
    this.peerMediaPaths.set(peerId, path);
    this.refreshPeerGains(peerId);
  }

  forgetPeerMediaPath(peerId: string): void {
    this.peerMediaPaths.delete(peerId);
    if (!this.channels.has(peerId) && !this.relayChannels.has(peerId)) {
      this.peerLoudnessStates.delete(peerId);
      this.publishPeerLevel(peerId, 0, true);
    }
  }

  removeRelayPeer(peerId: string): void {
    const channel = this.relayChannels.get(peerId);
    if (!channel) return;
    if (this.context) this.resetRelayQueue(channel, this.context);
    channel.gain.disconnect();
    channel.analyser.disconnect();
    this.relayChannels.delete(peerId);
    this.refreshPeerGains(peerId);
    if (!this.channels.has(peerId)) {
      this.peerLoudnessStates.delete(peerId);
      this.publishPeerLevel(peerId, 0, true);
    }
    this.stopMaintenanceTimersIfIdle();
  }

  destroy(): void {
    for (const [peerId] of this.channels) this.removeChannel(peerId);
    for (const [peerId] of this.relayChannels) this.removeRelayPeer(peerId);
    this.masterGain?.disconnect();
    this.outputLimiter?.disconnect();
    this.finalOutputTap?.disconnect();
    this.finalOutputTap?.stream.getTracks().forEach((track) => track.stop());
    this.stopMaintenanceTimers();
    const context = this.context;
    this.context = undefined;
    this.masterGain = undefined;
    this.outputLimiter = undefined;
    this.finalOutputTap = undefined;
    this.resumeInFlight = undefined;
    this.peerMediaPaths.clear();
    this.smoothedPeerLevels.clear();
    this.peerLoudnessStates.clear();
    void context?.close().catch(() => undefined);
  }

  private removeChannel(peerId: string): void {
    const channel = this.channels.get(peerId);
    if (!channel) return;
    channel.decoderPump.pause();
    channel.decoderPump.srcObject = null;
    channel.decoderPump.remove();
    channel.source.disconnect();
    channel.gain.disconnect();
    channel.analyser.disconnect();
    this.channels.delete(peerId);
    this.refreshPeerGains(peerId);
    if (!this.relayChannels.has(peerId)) {
      this.peerLoudnessStates.delete(peerId);
      this.publishPeerLevel(peerId, 0, true);
    }
    this.stopMaintenanceTimersIfIdle();
  }

  /**
   * Chromium can expose a live WebRTC track and growing RTP counters without
   * scheduling decoded PCM for a Web Audio-only consumer. A muted media
   * element keeps that decoder active, while the shared mixer remains the
   * sole audible output and continues to own volume/device routing.
   */
  private createDecoderPump(peerId: string, stream: MediaStream): HTMLAudioElement {
    const element = document.createElement("audio");
    element.autoplay = true;
    element.muted = true;
    element.setAttribute("playsinline", "true");
    element.controls = false;
    element.tabIndex = -1;
    element.setAttribute("aria-hidden", "true");
    element.style.cssText =
      "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none";
    element.srcObject = stream;
    document.body.appendChild(element);
    this.startDecoderPump(peerId, element, "remote-stream-sync");
    return element;
  }

  private resumeDecoderPumps(reason: string): void {
    for (const [peerId, channel] of this.channels) {
      if (channel.decoderPump.paused) {
        this.startDecoderPump(peerId, channel.decoderPump, reason);
      }
    }
  }

  private startDecoderPump(peerId: string, element: HTMLAudioElement, reason: string): void {
    void element.play().catch((error) => {
      void writeRendererLog("audio", "warn", "Remote audio decoder pump start failed", {
        peerId,
        reason,
        readyState: element.readyState,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private getOrCreateRelayChannel(
    peerId: string,
    context: SinkAwareAudioContext,
  ): RelayAudioChannel {
    const existing = this.relayChannels.get(peerId);
    if (existing) return existing;
    const gain = context.createGain();
    const analyser = this.createAnalyser(context);
    gain.gain.setValueAtTime(0, context.currentTime);
    analyser.connect(gain);
    gain.connect(this.masterGain!);
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
    this.startMaintenanceTimers();
    this.refreshPeerGains(peerId);
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

  private stopMaintenanceTimersIfIdle(): void {
    if (this.channels.size === 0 && this.relayChannels.size === 0) {
      this.stopMaintenanceTimers();
    }
  }

  private samplePeerLevels(): void {
    if (this.channels.size === 0 && this.relayChannels.size === 0) {
      this.stopMaintenanceTimers();
      return;
    }
    const peerIds = new Set([...this.channels.keys(), ...this.relayChannels.keys()]);
    for (const peerId of peerIds) {
      const webRtcChannel = this.channels.get(peerId);
      let webRtcMeasurement: { rms: number; peak: number } | undefined;
      if (webRtcChannel && this.hasWebRtcPlaybackChannel(peerId)) {
        webRtcMeasurement = this.measureChannelLevel(webRtcChannel);
        if (!webRtcChannel.hasObservedAudio && webRtcMeasurement.rms >= WEBRTC_AUDIO_PROOF_RMS) {
          webRtcChannel.hasObservedAudio = true;
          this.peerMediaPaths.set(peerId, "webrtc");
          this.refreshPeerGains(peerId);
          void writeRendererLog("audio", "info", "WebRTC playback graph verified by audio", {
            peerId,
            rms: Number(webRtcMeasurement.rms.toFixed(5)),
          });
        }
      }
      const path = this.getEffectivePeerPath(peerId);
      const channel =
        path === "webrtc" ? this.channels.get(peerId) : this.relayChannels.get(peerId);
      if (!channel) {
        this.publishPeerLevel(peerId, 0);
        continue;
      }
      const measurement =
        channel === webRtcChannel && webRtcMeasurement
          ? webRtcMeasurement
          : this.measureChannelLevel(channel);
      this.updatePeerLoudness(peerId, measurement);
      const normalized = Math.min(1, measurement.rms * 5.2);
      this.publishPeerLevel(peerId, normalized);
    }
  }

  private measureChannelLevel(channel: RemoteAudioChannel | RelayAudioChannel): {
    rms: number;
    peak: number;
  } {
    channel.analyser.getFloatTimeDomainData(channel.sampleBuffer);
    let energy = 0;
    let peak = 0;
    for (const sample of channel.sampleBuffer) {
      energy += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      rms: Math.sqrt(energy / Math.max(1, channel.sampleBuffer.length)),
      peak,
    };
  }

  private updatePeerLoudness(peerId: string, measurement: { rms: number; peak: number }): void {
    const previous = this.peerLoudnessStates.get(peerId) ?? createLoudnessBalanceState();
    const next = advanceLoudnessBalance(previous, {
      ...measurement,
      now: performance.now(),
      enabled: this.loudnessBalanceEnabled,
    });
    if (next === previous) return;
    this.peerLoudnessStates.set(peerId, next);
    if (Math.abs(next.gain - previous.gain) >= 0.003) this.refreshPeerGains(peerId);
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

  private refreshPeerGains(peerId: string): void {
    const context = this.context;
    if (!context) return;
    const effectivePath = this.getEffectivePeerPath(peerId);
    const loudnessGain = this.peerLoudnessStates.get(peerId)?.gain ?? 1;
    const webRtcChannel = this.channels.get(peerId);
    if (webRtcChannel) {
      webRtcChannel.gain.gain.setTargetAtTime(
        effectivePath === "webrtc"
          ? applyLoudnessBalanceToMemberVolume(
              clampMemberVolume(webRtcChannel.volume),
              loudnessGain,
              this.loudnessBalanceEnabled,
            )
          : 0,
        context.currentTime,
        REMOTE_AUDIO_GAIN_RAMP_SECONDS,
      );
    }
    const relayChannel = this.relayChannels.get(peerId);
    if (relayChannel) {
      relayChannel.gain.gain.setTargetAtTime(
        effectivePath === "relay"
          ? applyLoudnessBalanceToMemberVolume(
              clampMemberVolume(relayChannel.volume),
              loudnessGain,
              this.loudnessBalanceEnabled,
            )
          : 0,
        context.currentTime,
        REMOTE_AUDIO_GAIN_RAMP_SECONDS,
      );
    }
  }

  private getEffectiveMasterVolume(): number {
    return this.isDeafened ? 0 : this.masterVolume;
  }

  private applyMasterVolume(): void {
    if (!this.context || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(
      this.getEffectiveMasterVolume(),
      this.context.currentTime,
      0.012,
    );
  }

  private async applyOutputDevice(): Promise<void> {
    const context = this.context;
    if (!context?.setSinkId) return;
    try {
      await context.setSinkId(this.outputDeviceId || "default");
    } catch (error) {
      const failedOutputDeviceId = this.outputDeviceId;
      void writeRendererLog("audio", "warn", "Failed to route shared audio mixer output", {
        outputDeviceId: failedOutputDeviceId || "default",
        error: error instanceof Error ? error.message : String(error),
      });
      if (!failedOutputDeviceId) return;
      try {
        await context.setSinkId("default");
        this.outputDeviceId = undefined;
        void writeRendererLog("audio", "warn", "Shared audio mixer fell back to default output", {
          failedOutputDeviceId,
        });
      } catch (fallbackError) {
        void writeRendererLog("audio", "error", "Default audio output fallback failed", {
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
      }
    }
  }
}

let sharedRemoteAudioMixer: RemoteAudioMixer | undefined;

export const getRemoteAudioMixer = (): RemoteAudioMixer => {
  sharedRemoteAudioMixer ??= new RemoteAudioMixer();
  return sharedRemoteAudioMixer;
};
