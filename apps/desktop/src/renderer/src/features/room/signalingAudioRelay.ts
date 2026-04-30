import type { AudioChunkMessage } from "@private-voice/signaling";

interface SignalingAudioRelayOptions {
  roomId: string;
  peerId: string;
  localStream: MediaStream;
  send: (message: AudioChunkMessage) => Promise<void>;
  shouldPlayPeer: (peerId: string) => boolean;
  onLog?: (level: "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
}

const CHUNK_SIZE = 2048;
const PLAYBACK_BUFFER_SECONDS = 0.06;

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

class FallbackAudioPlayer {
  private readonly context = new AudioContext({ latencyHint: "interactive" });
  private nextPlayTime = 0;

  play(message: AudioChunkMessage): void {
    const samples = int16ToFloat(decodeBase64ToInt16(message.data));
    if (samples.length === 0) {
      return;
    }

    const buffer = this.context.createBuffer(1, samples.length, message.sampleRate);
    buffer.getChannelData(0).set(samples);

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const now = this.context.currentTime;
    if (this.nextPlayTime < now + 0.01 || this.nextPlayTime > now + 0.5) {
      this.nextPlayTime = now + PLAYBACK_BUFFER_SECONDS;
    }

    source.start(this.nextPlayTime);
    this.nextPlayTime += buffer.duration;
  }

  async resume(): Promise<void> {
    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  destroy(): void {
    void this.context.close().catch(() => undefined);
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
      if (this.isDestroyed || this.isMuted || !this.shouldSendAudio) {
        return;
      }

      const [track] = this.options.localStream.getAudioTracks();
      if (!track || track.readyState !== "live" || !track.enabled) {
        return;
      }

      const input = event.inputBuffer.getChannelData(0);
      const data = encodeInt16ToBase64(floatToInt16(input));
      void this.options
        .send({
          type: "audio_chunk",
          roomId: this.options.roomId,
          peerId: this.options.peerId,
          sequence: this.sequence,
          sampleRate: context.sampleRate,
          channelCount: 1,
          data,
          createdAt: new Date().toISOString(),
        })
        .catch((error) => {
          this.options.onLog?.("warn", "signaling audio relay send failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      this.sequence += 1;
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
    });
  }

  setMuted(isMuted: boolean): void {
    this.isMuted = isMuted;
  }

  setShouldSend(shouldSend: boolean): void {
    this.shouldSendAudio = shouldSend;
  }

  async replaceLocalStream(localStream: MediaStream): Promise<void> {
    this.options.localStream = localStream;

    if (!this.context || this.isDestroyed) {
      return;
    }

    if (!this.processor) {
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

    const player = this.players.get(message.peerId) ?? new FallbackAudioPlayer();
    this.players.set(message.peerId, player);
    void player
      .resume()
      .then(() => player.play(message))
      .catch((error) => {
        this.options.onLog?.("warn", "signaling audio relay playback failed", {
          peerId: message.peerId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  destroy(): void {
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
  }
}
