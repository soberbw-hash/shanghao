import type {
  AudioChunkMessage,
  AudioResyncAckMessage,
  AudioResyncRequestMessage,
} from "@private-voice/signaling";

import { getRemoteAudioMixer } from "../audio/RemoteAudioMixer";

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
  getTargetPeerIds: () => string[];
  getPeerVolume: (peerId: string) => number;
  onLog?: (
    level: "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ) => void;
}

interface PlaybackStats {
  queueLength: number;
  queueDurationMs: number;
  droppedOldChunks: number;
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
  fallbackStatus:
    "observing" | "relay_active" | "relay_receiving_but_dropping" | "relay_no_audio_received";
}

const CHUNK_SIZE = 1024;
const RELAY_SAMPLE_RATE = 16_000;
const MIN_SEND_INTERVAL_MS = 20;
const MAX_PACKET_AGE_MS = 3_000;
const METRICS_LOG_INTERVAL_MS = 5_000;
const RESYNC_DROP_THRESHOLD = 20;
const RELAY_CAPTURE_WORKLET = "shanghao-relay-capture";
const RELAY_CAPTURE_WORKLET_SOURCE = `
class ShangHaoRelayCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(${CHUNK_SIZE});
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    let sourceOffset = 0;
    while (sourceOffset < channel.length) {
      const writable = Math.min(this.buffer.length - this.offset, channel.length - sourceOffset);
      this.buffer.set(channel.subarray(sourceOffset, sourceOffset + writable), this.offset);
      this.offset += writable;
      sourceOffset += writable;
      if (this.offset === this.buffer.length) {
        const completed = this.buffer;
        this.port.postMessage(completed.buffer, [completed.buffer]);
        this.buffer = new Float32Array(${CHUNK_SIZE});
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("${RELAY_CAPTURE_WORKLET}", ShangHaoRelayCapture);
`;

const encodeBytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

const decodeBase64ToBytes = (payload: string): Uint8Array => {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const int16ToFloat = (input: Int16Array): Float32Array => {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] = (input[index] ?? 0) / 0x8000;
  }
  return output;
};

const MULAW_BIAS = 0x84;
const MULAW_CLIP = 32_635;

const floatToMuLaw = (input: Float32Array): Uint8Array => {
  const output = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    let sample = Math.round(Math.max(-1, Math.min(1, input[index] ?? 0)) * 0x7fff);
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    sample = Math.min(MULAW_CLIP, sample) + MULAW_BIAS;
    let exponent = 7;
    for (let mask = 0x4000; exponent > 0 && (sample & mask) === 0; mask >>= 1) {
      exponent -= 1;
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    output[index] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return output;
};

const muLawToFloat = (input: Uint8Array): Float32Array => {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const encoded = ~(input[index] ?? 0) & 0xff;
    const sign = encoded & 0x80;
    const exponent = (encoded >> 4) & 0x07;
    const mantissa = encoded & 0x0f;
    let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
    sample -= MULAW_BIAS;
    output[index] = (sign ? -sample : sample) / 0x8000;
  }
  return output;
};

const decodeRelaySamples = (message: AudioChunkMessage): Float32Array => {
  const bytes = decodeBase64ToBytes(message.data);
  if (message.codec === "mulaw") {
    return muLawToFloat(bytes);
  }
  const aligned = bytes.byteLength % 2 === 0 ? bytes : bytes.subarray(0, bytes.byteLength - 1);
  return int16ToFloat(new Int16Array(aligned.buffer, aligned.byteOffset, aligned.byteLength / 2));
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
  private readonly mixer = getRemoteAudioMixer();
  private volume = 1;
  private lastStats: PlaybackStats = {
    queueLength: 0,
    queueDurationMs: 0,
    droppedOldChunks: 0,
  };

  constructor(private readonly peerId: string) {}

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(2, volume));
  }

  play(message: AudioChunkMessage): PlaybackStats {
    const samples = decodeRelaySamples(message);
    if (samples.length === 0) {
      return this.lastStats;
    }

    this.lastStats = this.mixer.playRelaySamples(
      this.peerId,
      samples,
      message.sampleRate,
      message.durationMs,
      this.volume,
    );
    return this.lastStats;
  }

  async resume(): Promise<void> {
    await this.mixer.unlock("signaling-audio-relay");
  }

  clear(): void {
    this.mixer.clearRelayPeer(this.peerId);
    this.lastStats = { ...this.lastStats, queueLength: 0, queueDurationMs: 0 };
  }

  destroy(): void {
    this.mixer.removeRelayPeer(this.peerId);
  }
}

export class SignalingAudioRelay {
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private workletNode?: AudioWorkletNode;
  private captureNode?: AudioNode;
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
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    let captureNode: AudioNode;
    try {
      const moduleUrl = URL.createObjectURL(
        new Blob([RELAY_CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }),
      );
      try {
        await context.audioWorklet.addModule(moduleUrl);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
      const workletNode = new AudioWorkletNode(context, RELAY_CAPTURE_WORKLET, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
      });
      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        this.sendCapturedAudio(new Float32Array(event.data), context.sampleRate);
      };
      this.workletNode = workletNode;
      captureNode = workletNode;
      this.recordTimeline("audio_worklet_started");
    } catch (error) {
      const processor = context.createScriptProcessor(CHUNK_SIZE, 1, 1);
      processor.onaudioprocess = (event) => {
        this.sendCapturedAudio(event.inputBuffer.getChannelData(0), context.sampleRate);
      };
      this.processor = processor;
      captureNode = processor;
      this.options.onLog?.("warn", "audio worklet unavailable, using compatibility capture", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.recordTimeline("script_processor_fallback_started");
    }

    source.connect(captureNode);
    captureNode.connect(silentGain);
    silentGain.connect(context.destination);
    this.context = context;
    this.source = source;
    this.captureNode = captureNode;
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
    if (!this.context || this.isDestroyed || !this.captureNode) {
      return;
    }
    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(localStream);
    this.source.connect(this.captureNode);
  }

  handleRemoteChunk(message: AudioChunkMessage): void {
    const receivedAt = performance.now();
    if (
      this.isDestroyed ||
      message.peerId === this.options.peerId ||
      !this.options.shouldPlayPeer(message.peerId)
    ) {
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
    const player = this.players.get(message.peerId) ?? new FallbackAudioPlayer(message.peerId);
    this.players.set(message.peerId, player);
    player.setVolume(this.options.getPeerVolume(message.peerId));
    void player
      .resume()
      .then(() => {
        const stats = player.play(message);
        state.lastGoodSequence = message.sequence;
        state.lastPlayedAt = performance.now();
        state.droppedConsecutive = 0;
        state.resyncPending = false;
        if (state.fallbackStatus !== "relay_active") {
          state.fallbackStatus = "relay_active";
          this.recordTimeline("relay_first_chunk_played", {
            peerId: message.peerId,
            queueDurationMs: stats.queueDurationMs,
          });
        }
        this.logReceiveMetrics(message, estimatedServerAgeMs, receivedAt, stats, state);
      })
      .catch((error) => {
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
    this.recordTimeline("audio_resync_completed", {
      peerId: message.peerId,
      reason: message.reason,
    });
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
    if (this.processor) {
      this.processor.onaudioprocess = null;
    }
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
    }
    this.captureNode?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    void this.context?.close().catch(() => undefined);
    for (const player of this.players.values()) {
      player.destroy();
    }
    this.players.clear();
    this.recordTimeline("mic_stopped");
  }

  private sendCapturedAudio(input: Float32Array, sourceSampleRate: number): void {
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

    const durationMs = (input.length / sourceSampleRate) * 1_000;
    const relaySamples = downsampleMono(input, sourceSampleRate, RELAY_SAMPLE_RATE);
    const targetPeerIds = this.options.getTargetPeerIds();
    if (targetPeerIds.length === 0) {
      return;
    }
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
        codec: "mulaw",
        targetPeerIds,
        data: encodeBytesToBase64(floatToMuLaw(relaySamples)),
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
    this.logReceiveMetrics(
      message,
      estimatedServerAgeMs,
      performance.now(),
      undefined,
      state,
      reason,
    );
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
    this.recordTimeline("audio_resync_requested", {
      peerId,
      reason,
      droppedChunks: state.droppedTotal,
    });
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
        this.recordTimeline("peer_audio_silent_timeout", {
          peerId,
          reason: "relay_no_audio_received",
        });
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
