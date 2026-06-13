import type { AudioChunkMessage } from "@private-voice/signaling";

interface SignalingAudioRelayOptions {
  roomId: string;
  peerId: string;
  localStream: MediaStream;
  send: (message: AudioChunkMessage) => Promise<void>;
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

const CHUNK_SIZE = 2048;
const MIN_SEND_INTERVAL_MS = 35;
const MAX_PACKET_AGE_MS = 1_000;
const MAX_QUEUE_DURATION_MS = 800;
const MAX_QUEUE_CHUNKS = 20;
const PLAYBACK_LEAD_SECONDS = 0.04;
const METRICS_LOG_INTERVAL_MS = 5_000;

const encodeInt16ToBase64 = (samples: Int16Array): string => {
  const bytes = new Uint8Array(samples.buffer);
  let binary = "";
  const batchSize = 0x8000;

  for (let index = 0; index < bytes.length; index += batchSize) {
    const batch = bytes.subarray(index, index + batchSize);
    binary += String.fromCharCode(...batch);
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

const messageSentAt = (message: AudioChunkMessage): number => {
  if (Number.isFinite(message.sentAt)) {
    return message.sentAt;
  }

  const legacyTimestamp = message.createdAt ? Date.parse(message.createdAt) : Number.NaN;
  return Number.isFinite(legacyTimestamp) ? legacyTimestamp : Date.now();
};

class FallbackAudioPlayer {
  private readonly context = new AudioContext({ latencyHint: "interactive" });
  private nextPlayTime = 0;
  private droppedOldChunks = 0;
  private readonly scheduled: ScheduledChunk[] = [];

  play(message: AudioChunkMessage): PlaybackStats {
    const samples = int16ToFloat(decodeBase64ToInt16(message.data));
    if (samples.length === 0) {
      return this.getStats();
    }

    const now = this.context.currentTime;
    this.pruneFinished(now);

    if (this.nextPlayTime < now) {
      this.nextPlayTime = now + PLAYBACK_LEAD_SECONDS;
    }

    if (this.nextPlayTime - now > MAX_QUEUE_DURATION_MS / 1_000) {
      this.clear();
      this.nextPlayTime = now + PLAYBACK_LEAD_SECONDS;
    }

    const incomingDurationMs =
      message.durationMs > 0 ? message.durationMs : (samples.length / message.sampleRate) * 1_000;
    while (
      this.scheduled.length >= MAX_QUEUE_CHUNKS ||
      Math.max(0, this.nextPlayTime - now) * 1_000 + incomingDurationMs > MAX_QUEUE_DURATION_MS
    ) {
      if (!this.dropOldest()) {
        break;
      }
    }
    if (this.scheduled.length === 0) {
      this.nextPlayTime = now + PLAYBACK_LEAD_SECONDS;
    }

    const buffer = this.context.createBuffer(1, samples.length, message.sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start(this.nextPlayTime);
    this.scheduled.push({
      source,
      startsAt: this.nextPlayTime,
      durationMs: buffer.duration * 1_000,
    });
    this.nextPlayTime += buffer.duration;
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
        // Already stopped sources are safe to ignore.
      }
      chunk.source.disconnect();
    }
    this.nextPlayTime = this.context.currentTime + PLAYBACK_LEAD_SECONDS;
  }

  destroy(): void {
    this.clear();
    void this.context.close().catch(() => undefined);
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
      // Already stopped sources are safe to ignore.
    }
    oldest.source.disconnect();
    this.droppedOldChunks += 1;
    return true;
  }

  private getStats(): PlaybackStats {
    return {
      queueLength: this.scheduled.length,
      queueDurationMs: Math.max(0, this.nextPlayTime - this.context.currentTime) * 1_000,
      droppedOldChunks: this.droppedOldChunks,
    };
  }
}

export class SignalingAudioRelay {
  private context?: AudioContext;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private silentGain?: GainNode;
  private sequence = 0;
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
  private readonly players = new Map<string, FallbackAudioPlayer>();

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
      const now = Date.now();
      if (
        this.isDestroyed ||
        this.isMuted ||
        !this.shouldSendAudio ||
        this.isSendInFlight ||
        now - this.lastSendAt < MIN_SEND_INTERVAL_MS
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
      const data = encodeInt16ToBase64(floatToInt16(input));
      this.isSendInFlight = true;
      this.lastSendAt = now;
      this.sentSinceMetricsLog += 1;
      void this.options
        .send({
          type: "audio_chunk",
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          sequence: this.sequence,
          sentAt: now,
          durationMs,
          sampleRate: context.sampleRate,
          channelCount: 1,
          data,
        })
        .catch((error) => {
          this.options.onLog?.("warn", "signaling audio relay send failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.isSendInFlight = false;
        });
      this.sequence += 1;
      this.logSendMetrics(now);
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);

    this.context = context;
    this.source = source;
    this.processor = processor;
    this.silentGain = silentGain;
    this.options.onLog?.("info", "signaling audio relay started", {
      sampleRate: context.sampleRate,
      chunkSize: CHUNK_SIZE,
      maxPacketAgeMs: MAX_PACKET_AGE_MS,
      maxQueueDurationMs: MAX_QUEUE_DURATION_MS,
      maxQueueChunks: MAX_QUEUE_CHUNKS,
    });
  }

  setMuted(isMuted: boolean): void {
    this.isMuted = isMuted;
  }

  setShouldSend(shouldSend: boolean): void {
    if (this.shouldSendAudio === shouldSend) {
      return;
    }

    this.shouldSendAudio = shouldSend;
    this.options.onLog?.(
      "info",
      shouldSend ? "signaling audio relay sending enabled" : "signaling audio relay sending disabled",
      { audioPath: shouldSend ? "relay" : "webrtc" },
    );
  }

  async replaceLocalStream(localStream: MediaStream): Promise<void> {
    this.options.localStream = localStream;

    if (!this.context || this.isDestroyed || !this.processor) {
      return;
    }

    this.source?.disconnect();
    this.source = this.context.createMediaStreamSource(localStream);
    this.source.connect(this.processor);
  }

  handleRemoteChunk(message: AudioChunkMessage): void {
    if (this.isDestroyed || message.peerId === this.options.peerId || !this.options.shouldPlayPeer(message.peerId)) {
      return;
    }

    const ageMs = Math.max(0, Date.now() - messageSentAt(message));
    if (ageMs > MAX_PACKET_AGE_MS) {
      this.droppedExpiredChunks += 1;
      this.logReceiveMetrics(message, ageMs, undefined);
      return;
    }

    const player = this.players.get(message.peerId) ?? new FallbackAudioPlayer();
    this.players.set(message.peerId, player);
    void player
      .resume()
      .then(() => {
        const stats = player.play(message);
        this.logReceiveMetrics(message, ageMs, stats);
      })
      .catch((error) => {
        this.options.onLog?.("warn", "signaling audio relay playback failed", {
          peerId: message.peerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  clearPeer(peerId: string, reason: string): void {
    const player = this.players.get(peerId);
    if (!player) {
      return;
    }

    player.clear();
    this.options.onLog?.("info", "signaling audio relay peer queue cleared", {
      peerId,
      reason,
    });
  }

  resetTransport(reason: string): void {
    this.isSendInFlight = false;
    this.lastSendAt = 0;
    for (const [peerId, player] of this.players) {
      player.clear();
      this.options.onLog?.("info", "signaling audio relay peer queue cleared", {
        peerId,
        reason,
      });
    }
  }

  destroy(): void {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.processor?.disconnect();
    this.source?.disconnect();
    this.silentGain?.disconnect();
    void this.context?.close().catch(() => undefined);

    for (const player of this.players.values()) {
      player.destroy();
    }

    this.players.clear();
    this.context = undefined;
    this.processor = undefined;
    this.source = undefined;
    this.silentGain = undefined;
    this.options.onLog?.("info", "signaling audio relay stopped", {
      droppedExpiredChunks: this.droppedExpiredChunks,
      droppedSendChunks: this.droppedSendChunks,
    });
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
      droppedSendChunks: this.droppedSendChunks,
      audioPath: "relay",
    });
    this.lastSendMetricsLogAt = now;
    this.sentSinceMetricsLog = 0;
  }

  private logReceiveMetrics(
    message: AudioChunkMessage,
    ageMs: number,
    stats: PlaybackStats | undefined,
  ): void {
    const now = Date.now();
    if (now - this.lastReceiveMetricsLogAt < METRICS_LOG_INTERVAL_MS && stats) {
      return;
    }

    this.options.onLog?.(ageMs > MAX_PACKET_AGE_MS ? "warn" : "info", "signaling audio relay receive metrics", {
      peerId: message.peerId,
      sequence: message.sequence,
      ageMs,
      queueLength: stats?.queueLength ?? 0,
      queueDurationMs: Math.round(stats?.queueDurationMs ?? 0),
      droppedOldChunks: stats?.droppedOldChunks ?? 0,
      droppedExpiredChunks: this.droppedExpiredChunks,
      audioPath: "relay",
    });
    this.lastReceiveMetricsLogAt = now;
  }
}
