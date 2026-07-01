import type {
  AudioChunkMessage,
  AudioResyncAckMessage,
  AudioResyncRequestMessage,
} from "@private-voice/signaling";

type AudioRelayMessage = AudioChunkMessage | AudioResyncRequestMessage | AudioResyncAckMessage;
type AudioTimelineEvent = {
  time: string;
  event: string;
  peerId?: string;
  fromPath?: "webrtc" | "relay";
  toPath?: "webrtc" | "relay";
  reason?: string;
  audioStreamEpoch: number;
  queueDurationMs?: number;
  droppedChunks?: number;
  serverClockOffsetMs?: number;
};

interface SignalingAudioRelayOptions {
  roomId: string;
  peerId: string;
  localStream: MediaStream;
  send: (message: AudioRelayMessage) => Promise<void>;
  shouldPlayPeer: (peerId: string) => boolean;
  onLog?: (level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
}

interface PlaybackStats {
  queueLength: number;
  queueDurationMs: number;
  droppedOldChunks: number;
}

interface ScheduledChunk {
  source: AudioBufferSourceNode;
  startsAt: number;
  durationMs: number;
}

interface PeerAudioState {
  audioSessionId?: string;
  audioStreamEpoch: number;
  lastSequence: number;
  lastGoodSequence: number;
  droppedConsecutive: number;
  droppedTotal: number;
  queueResets: number;
  fallbackEnabledAt: number;
  lastReceivedAt?: number;
  lastPlayedAt?: number;
  resyncPending: boolean;
  fallbackStatus: "observing" | "relay_active" | "relay_receiving_but_dropping" | "relay_no_audio_received";
}

const CHUNK_SIZE = 1024;
const RELAY_SAMPLE_RATE = 16_000;
const MIN_SEND_INTERVAL_MS = 20;
const MAX_PACKET_AGE_MS = 3_000;
const MAX_QUEUE_DURATION_MS = 1_200;
const MAX_QUEUE_CHUNKS = 60;
const PLAYBACK_LEAD_SECONDS = 0.1;
const METRICS_LOG_INTERVAL_MS = 5_000;
const RESYNC_DROP_THRESHOLD = 20;

const encodeInt16ToBase64 = (samples: Int16Array): string => {
  const bytes = new Uint8Array(samples.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const decodeBase64ToInt16 = (payload: string): Int16Array => {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Int16Array(bytes.buffer);
};

const floatToInt16 = (input: Float32Array): Int16Array => {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
};

const int16ToFloat = (input: Int16Array): Float32Array => {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = (input[index] ?? 0) / 0x8000;
  }
  return output;
};

const downsampleMono = (
  input: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array => {
  if (sourceSampleRate <= targetSampleRate) {
    return new Float32Array(input);
  }

  const ratio = sourceSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((outputIndex + 1) * ratio)));
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
      sum += input[inputIndex] ?? 0;
    }
    output[outputIndex] = sum / Math.max(1, end - start);
  }
  return output;
};

class FallbackAudioPlayer {
  private readonly context = new AudioContext({ latencyHint: "interactive" });
  private nextPlaybackTime = 0;
  private droppedOldChunks = 0;
  private readonly scheduled: ScheduledChunk[] = [];

  play(message: AudioChunkMessage): PlaybackStats {
    const samples = int16ToFloat(decodeBase64ToInt16(message.data));
    if (samples.length === 0) {
      return this.getStats();
    }

    const now = this.context.currentTime;
    this.pruneFinished(now);
    if (this.nextPlaybackTime < now) {
      this.nextPlaybackTime = now + PLAYBACK_LEAD_SECONDS;
    }
    if (this.nextPlaybackTime - now > MAX_QUEUE_DURATION_MS / 1_000) {
      this.clear();
    }

    const incomingDurationMs =
      message.durationMs > 0 ? message.durationMs : (samples.length / message.sampleRate) * 1_000;
    while (
      this.scheduled.length >= MAX_QUEUE_CHUNKS ||
      Math.max(0, this.nextPlaybackTime - now) * 1_000 + incomingDurationMs > MAX_QUEUE_DURATION_MS
    ) {
      if (!this.dropOldest()) {
        break;
      }
    }
    if (this.scheduled.length === 0) {
      this.nextPlaybackTime = this.context.currentTime + PLAYBACK_LEAD_SECONDS;
    }

    const buffer = this.context.createBuffer(1, samples.length, message.sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start(this.nextPlaybackTime);
    this.scheduled.push({ source, startsAt: this.nextPlaybackTime, durationMs: buffer.duration * 1_000 });
    this.nextPlaybackTime += buffer.duration;
    return this.getStats();
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  clear(): void {
    for (const chunk of this.scheduled.splice(0)) {
      try {
        chunk.source.stop();
      } catch {
        // Already stopped.
      }
      chunk.source.disconnect();
    }
    this.nextPlaybackTime = this.context.currentTime + PLAYBACK_LEAD_SECONDS;
  }

  destroy(): void {
    this.clear();
    void this.context.close().catch(() => undefined);
  }

  getStats(): PlaybackStats {
    return {
      queueLength: this.scheduled.length,
      queueDurationMs: Math.max(0, this.nextPlaybackTime - this.context.currentTime) * 1_000,
      droppedOldChunks: this.droppedOldChunks,
    };
  }

  private pruneFinished(now: number): void {
    while (this.scheduled[0]) {
      const first = this.scheduled[0];
      if (first.startsAt + first.durationMs / 1_000 > now) {
        break;
      }
      first.source.disconnect();
      this.scheduled.shift();
    }
  }

  private dropOldest(): boolean {
    const oldest = this.scheduled.shift();
    if (!oldest) {
      return false;
    }
    try {
      oldest.source.stop();
    } catch {
      // Already stopped.
    }
    oldest.source.disconnect();
    this.droppedOldChunks += 1;
    return true;
  }
}

export class SignalingAudioRelay {
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private silentGain?: GainNode;
  private sequence = 0;
  private audioStreamEpoch = 1;
  private readonly audioSessionId = crypto.randomUUID();
  private isMuted = false;
  private shouldSendAudio = false;
  private isDestroyed = false;
  private isSendInFlight = false;
  private lastSendAt = 0;
  private lastSendMetricsLogAt = 0;
  private lastReceiveMetricsLogAt = 0;
  private sentSinceMetricsLog = 0;
  private droppedSendChunks = 0;
  private droppedExpiredChunks = 0;
  private serverClockOffsetMs?: number;
  private watchdogTimer?: number;
  private readonly players = new Map<string, FallbackAudioPlayer>();
  private readonly peerStates = new Map<string, PeerAudioState>();
  private readonly timeline: AudioTimelineEvent[] = [];

  constructor(private readonly options: SignalingAudioRelayOptions) {}

  async start(): Promise<void> {
    if (this.context || this.isDestroyed) {
      return;
    }
    const context = new AudioContext({ latencyHint: "interactive" });
    if (context.state === "suspended") {
      await context.resume();
    }
    const source = context.createMediaStreamSource(this.options.localStream);
    const processor = context.createScriptProcessor(CHUNK_SIZE, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = (event) => {
      const monotonicNow = performance.now();
      if (
        this.isDestroyed ||
        this.isMuted ||
        !this.shouldSendAudio ||
        this.isSendInFlight ||
        monotonicNow - this.lastSendAt < MIN_SEND_INTERVAL_MS
      ) {
        if (this.isSendInFlight) {
          this.droppedSendChunks += 1;
        }
        return;
      }
      const [track] = this.options.localStream.getAudioTracks();
      if (!track || track.readyState !== "live" || !track.enabled) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const durationMs = (input.length / context.sampleRate) * 1_000;
      const relaySamples = downsampleMono(input, context.sampleRate, RELAY_SAMPLE_RATE);
      this.isSendInFlight = true;
      this.lastSendAt = monotonicNow;
      this.sentSinceMetricsLog += 1;
      void this.options
        .send({
          type: "audio_chunk",
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          sourcePeerId: this.options.peerId,
          audioSessionId: this.audioSessionId,
          audioStreamEpoch: this.audioStreamEpoch,
          audioPath: "relay",
          sequence: this.sequence++,
          sentAt: Date.now(),
          capturedAtMonotonic: monotonicNow,
          durationMs,
          sampleRate: RELAY_SAMPLE_RATE,
          channelCount: 1,
          data: encodeInt16ToBase64(floatToInt16(relaySamples)),
        })
        .catch((error) => {
          this.droppedSendChunks += 1;
          this.options.onLog?.("warn", "signaling audio relay send failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.isSendInFlight = false;
        });
      this.logSendMetrics(monotonicNow);
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    this.context = context;
    this.source = source;
    this.processor = processor;
    this.silentGain = silentGain;
    this.watchdogTimer = window.setInterval(() => this.runWatchdog(), 1_000);
    this.recordTimeline("mic_started");
  }

  setServerClockOffsetMs(offsetMs: number): void {
    this.serverClockOffsetMs = offsetMs;
  }

  setMuted(isMuted: boolean): void {
    this.isMuted = isMuted;
  }

  setShouldSend(shouldSend: boolean): void {
    if (this.shouldSendAudio === shouldSend) {
      return;
    }
    const fromPath = this.shouldSendAudio ? "relay" : "webrtc";
    const toPath = shouldSend ? "relay" : "webrtc";
    this.shouldSendAudio = shouldSend;
    this.bumpEpoch(`audio_path_switched:${fromPath}_to_${toPath}`);
    this.recordTimeline("audio_path_switched", { fromPath, toPath });
  }

  async replaceLocalStream(localStream: MediaStream): Promise<void> {
    this.options.localStream = localStream;
    this.bumpEpoch("microphone_reinitialized");
    if (!this.context || this.isDestroyed || !this.processor) {
      return;
    }
    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(localStream);
    this.source.connect(this.processor);
  }

  handleRemoteChunk(message: AudioChunkMessage): void {
    const receivedAt = performance.now();
    if (this.isDestroyed || message.peerId === this.options.peerId || !this.options.shouldPlayPeer(message.peerId)) {
      return;
    }
    const state = this.getPeerState(message.peerId);
    state.lastReceivedAt = receivedAt;
    const estimatedServerAgeMs =
      this.serverClockOffsetMs !== undefined && message.serverForwardedAt !== undefined
        ? Math.max(0, Date.now() + this.serverClockOffsetMs - message.serverForwardedAt)
        : undefined;

    if (!state.audioSessionId) {
      state.audioSessionId = message.audioSessionId;
      state.audioStreamEpoch = message.audioStreamEpoch;
      this.recordTimeline("relay_first_chunk_received", { peerId: message.peerId });
    }
    if (
      state.audioSessionId !== message.audioSessionId ||
      message.audioStreamEpoch < state.audioStreamEpoch ||
      (estimatedServerAgeMs !== undefined && estimatedServerAgeMs > MAX_PACKET_AGE_MS)
    ) {
      this.dropChunk(message, state, "stale_generation_or_server_age", estimatedServerAgeMs);
      return;
    }
    if (message.audioStreamEpoch > state.audioStreamEpoch) {
      this.resetPeerQueue(message.peerId, state, "new_audio_stream_epoch");
      state.audioSessionId = message.audioSessionId;
      state.audioStreamEpoch = message.audioStreamEpoch;
    }
    if (message.sequence <= state.lastSequence) {
      this.dropChunk(message, state, "sequence_regressed", estimatedServerAgeMs);
      return;
    }

    state.lastSequence = message.sequence;
    const player = this.players.get(message.peerId) ?? new FallbackAudioPlayer();
    this.players.set(message.peerId, player);
    void player.resume().then(() => {
      const stats = player.play(message);
      state.lastGoodSequence = message.sequence;
      state.lastPlayedAt = performance.now();
      state.droppedConsecutive = 0;
      state.resyncPending = false;
      if (state.fallbackStatus !== "relay_active") {
        state.fallbackStatus = "relay_active";
        this.recordTimeline("relay_first_chunk_played", { peerId: message.peerId, queueDurationMs: stats.queueDurationMs });
      }
      this.logReceiveMetrics(message, estimatedServerAgeMs, receivedAt, stats, state);
    }).catch((error) => {
      this.dropChunk(message, state, "playback_failed", estimatedServerAgeMs);
      this.options.onLog?.("warn", "signaling audio relay playback failed", {
        peerId: message.peerId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  handleResyncRequest(message: AudioResyncRequestMessage): void {
    if (message.targetPeerId !== this.options.peerId) {
      return;
    }
    this.bumpEpoch(`resync_request:${message.reason}`);
    void this.options.send({
      type: "audio_resync_ack",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId: message.peerId,
      audioSessionId: this.audioSessionId,
      newAudioStreamEpoch: this.audioStreamEpoch,
      resetAt: Date.now(),
    });
    this.recordTimeline("audio_resync_completed", { peerId: message.peerId, reason: message.reason });
  }

  handleResyncAck(message: AudioResyncAckMessage): void {
    if (message.targetPeerId !== this.options.peerId) {
      return;
    }
    const state = this.getPeerState(message.peerId);
    this.resetPeerQueue(message.peerId, state, "audio_resync_ack");
    state.audioSessionId = message.audioSessionId;
    state.audioStreamEpoch = message.newAudioStreamEpoch;
    state.resyncPending = false;
    this.recordTimeline("audio_resync_completed", { peerId: message.peerId });
  }

  clearPeer(peerId: string, reason: string): void {
    const state = this.peerStates.get(peerId);
    if (state) {
      this.resetPeerQueue(peerId, state, reason);
    }
  }

  markPeerPath(peerId: string, path: "webrtc" | "relay", reason: string): void {
    const state = this.getPeerState(peerId);
    this.resetPeerQueue(peerId, state, reason);
    state.fallbackEnabledAt = performance.now();
    state.lastReceivedAt = undefined;
    state.lastPlayedAt = undefined;
    state.fallbackStatus = "observing";
    this.recordTimeline(path === "relay" ? "relay_fallback_enabled" : "webrtc_connected", {
      peerId,
      fromPath: path === "relay" ? "webrtc" : "relay",
      toPath: path,
      reason,
    });
  }

  resetTransport(reason: string): void {
    this.isSendInFlight = false;
    this.lastSendAt = 0;
    this.bumpEpoch(reason);
    for (const [peerId, state] of this.peerStates) {
      this.resetPeerQueue(peerId, state, reason);
    }
  }

  getDiagnostics() {
    return {
      audioSessionId: this.audioSessionId,
      audioStreamEpoch: this.audioStreamEpoch,
      serverClockOffsetMs: this.serverClockOffsetMs,
      droppedExpiredChunks: this.droppedExpiredChunks,
      droppedSendChunks: this.droppedSendChunks,
      perPeerAudioStatus: [...this.peerStates].map(([peerId, state]) => ({ peerId, ...state })),
      audioTimeline: this.timeline,
    };
  }

  destroy(): void {
    if (this.isDestroyed) {
      return;
    }
    this.isDestroyed = true;
    if (this.watchdogTimer) {
      window.clearInterval(this.watchdogTimer);
    }
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    void this.context?.close().catch(() => undefined);
    for (const player of this.players.values()) {
      player.destroy();
    }
    this.players.clear();
    this.recordTimeline("mic_stopped");
  }

  private getPeerState(peerId: string): PeerAudioState {
    const existing = this.peerStates.get(peerId);
    if (existing) {
      return existing;
    }
    const created: PeerAudioState = {
      audioStreamEpoch: -1,
      lastSequence: -1,
      lastGoodSequence: -1,
      droppedConsecutive: 0,
      droppedTotal: 0,
      queueResets: 0,
      fallbackEnabledAt: performance.now(),
      resyncPending: false,
      fallbackStatus: "observing",
    };
    this.peerStates.set(peerId, created);
    this.recordTimeline("relay_fallback_enabled", { peerId });
    return created;
  }

  private dropChunk(
    message: AudioChunkMessage,
    state: PeerAudioState,
    reason: string,
    estimatedServerAgeMs?: number,
  ): void {
    state.droppedConsecutive += 1;
    state.droppedTotal += 1;
    this.droppedExpiredChunks += 1;
    state.fallbackStatus = "relay_receiving_but_dropping";
    this.logReceiveMetrics(message, estimatedServerAgeMs, performance.now(), undefined, state, reason);
    if (state.droppedConsecutive >= RESYNC_DROP_THRESHOLD) {
      this.requestResync(message.peerId, state, reason);
    }
  }

  private requestResync(peerId: string, state: PeerAudioState, reason: string): void {
    if (state.resyncPending) {
      return;
    }
    state.resyncPending = true;
    this.resetPeerQueue(peerId, state, `resync:${reason}`);
    void this.options.send({
      type: "audio_resync_request",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      targetPeerId: peerId,
      reason,
      currentAudioStreamEpoch: state.audioStreamEpoch,
      lastGoodSequence: state.lastGoodSequence,
      droppedCount: state.droppedTotal,
    });
    this.recordTimeline("audio_resync_requested", { peerId, reason, droppedChunks: state.droppedTotal });
  }

  private resetPeerQueue(peerId: string, state: PeerAudioState, reason: string): void {
    this.players.get(peerId)?.clear();
    state.queueResets += 1;
    this.recordTimeline("audio_queue_reset", { peerId, reason, droppedChunks: state.droppedTotal });
  }

  private bumpEpoch(reason: string): void {
    this.audioStreamEpoch += 1;
    this.sequence = 0;
    this.options.onLog?.("info", "audio stream epoch advanced", {
      reason,
      audioSessionId: this.audioSessionId,
      audioStreamEpoch: this.audioStreamEpoch,
    });
  }

  private runWatchdog(): void {
    const now = performance.now();
    for (const [peerId, state] of this.peerStates) {
      if (state.lastReceivedAt && (!state.lastPlayedAt || now - state.lastPlayedAt > 3_000)) {
        state.fallbackStatus = "relay_receiving_but_dropping";
        this.requestResync(peerId, state, "relay_silent_timeout");
      } else if (
        !state.lastReceivedAt &&
        now - state.fallbackEnabledAt > 5_000 &&
        state.fallbackStatus !== "relay_no_audio_received"
      ) {
        state.fallbackStatus = "relay_no_audio_received";
        this.recordTimeline("peer_audio_silent_timeout", { peerId, reason: "relay_no_audio_received" });
      }
    }
  }

  private recordTimeline(event: string, context: Partial<AudioTimelineEvent> = {}): void {
    const item: AudioTimelineEvent = {
      time: new Date().toISOString(),
      event,
      audioStreamEpoch: context.audioStreamEpoch ?? this.audioStreamEpoch,
      serverClockOffsetMs: this.serverClockOffsetMs,
      ...context,
    };
    this.timeline.push(item);
    if (this.timeline.length > 200) {
      this.timeline.shift();
    }
    this.options.onLog?.("info", `audio_timeline:${event}`, item);
  }

  private logSendMetrics(now: number): void {
    if (this.lastSendMetricsLogAt === 0) {
      this.lastSendMetricsLogAt = now;
      return;
    }
    if (now - this.lastSendMetricsLogAt < METRICS_LOG_INTERVAL_MS) {
      return;
    }
    const elapsedSeconds = Math.max(1, (now - this.lastSendMetricsLogAt) / 1_000);
    this.options.onLog?.("info", "signaling audio relay send metrics", {
      sendFps: Number((this.sentSinceMetricsLog / elapsedSeconds).toFixed(1)),
      sentAudioChunks: this.sentSinceMetricsLog,
      skippedAudioChunks: this.droppedSendChunks,
      audioStreamEpoch: this.audioStreamEpoch,
      audioPath: "relay",
    });
    this.lastSendMetricsLogAt = now;
    this.sentSinceMetricsLog = 0;
  }

  private logReceiveMetrics(
    message: AudioChunkMessage,
    estimatedServerAgeMs: number | undefined,
    receivedAt: number,
    stats: PlaybackStats | undefined,
    state: PeerAudioState,
    reason?: string,
  ): void {
    const now = performance.now();
    if (now - this.lastReceiveMetricsLogAt < METRICS_LOG_INTERVAL_MS && stats) {
      return;
    }
    this.options.onLog?.(reason ? "warn" : "info", "signaling audio relay receive metrics", {
      peerId: message.peerId,
      sequence: message.sequence,
      serverSequence: message.serverSequence,
      senderSentAt: message.sentAt,
      serverReceivedAt: message.serverReceivedAt,
      serverForwardedAt: message.serverForwardedAt,
      estimatedServerAgeMs,
      localReceiveDelayMs: Math.max(0, performance.now() - receivedAt),
      serverClockOffsetMs: this.serverClockOffsetMs,
      audioSessionId: message.audioSessionId,
      audioStreamEpoch: message.audioStreamEpoch,
      queueLength: stats?.queueLength ?? 0,
      queueDurationMs: Math.round(stats?.queueDurationMs ?? 0),
      droppedOldChunks: stats?.droppedOldChunks ?? 0,
      droppedExpiredChunks: this.droppedExpiredChunks,
      fallbackStatus: state.fallbackStatus,
      reason,
    });
    this.lastReceiveMetricsLogAt = now;
  }
}
