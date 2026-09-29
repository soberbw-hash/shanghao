import type { RecordingCapability } from "@private-voice/shared";

export interface RecordingEncoder {
  readonly capability: RecordingCapability;
  hasRecording: () => boolean;
  start: (stream: MediaStream, onChunk?: (buffer: ArrayBuffer) => Promise<void>) => void;
  stop: () => Promise<{ blob?: Blob; mimeType: string; durationMs: number }>;
}

// The room mix is mono voice. 32 kbps keeps long gaming sessions practical while
// retaining enough speech detail for playback and the local ASR pipeline.
export const RECORDING_AUDIO_BITS_PER_SECOND = 32_000;

export class BrowserRecordingEncoder implements RecordingEncoder {
  readonly capability: RecordingCapability;
  private mediaRecorder?: MediaRecorder;
  private chunks: BlobPart[] = [];
  private pendingChunks: Blob[] = [];
  private pendingBytes = 0;
  private drainPromise?: Promise<void>;
  private chunkWriter?: (buffer: ArrayBuffer) => Promise<void>;
  private streamError?: Error;
  private pausedForBackpressure = false;
  private startedAt = 0;
  private stopPromise?: Promise<void>;

  private readonly maxPendingBytes = 4 * 1024 * 1024;
  private readonly resumePendingBytes = 1 * 1024 * 1024;

  hasRecording(): boolean {
    return Boolean(this.mediaRecorder);
  }

  constructor(capability: RecordingCapability) {
    this.capability = capability;
  }

  start(stream: MediaStream, onChunk?: (buffer: ArrayBuffer) => Promise<void>): void {
    if (!this.capability.mimeType) {
      throw new Error("当前设备没有检测到可用的录音 MIME 类型。");
    }

    if (this.mediaRecorder) {
      throw new Error("已有录音正在进行，请先结束当前录音。");
    }

    this.chunks = [];
    this.pendingChunks = [];
    this.pendingBytes = 0;
    this.drainPromise = undefined;
    this.chunkWriter = onChunk;
    this.streamError = undefined;
    this.pausedForBackpressure = false;
    this.startedAt = Date.now();
    const recorder = new MediaRecorder(stream, {
      mimeType: this.capability.mimeType,
      audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND,
    });
    this.mediaRecorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        if (this.chunkWriter) {
          this.pendingChunks.push(event.data);
          this.pendingBytes += event.data.size;
          if (this.pendingBytes >= this.maxPendingBytes && recorder.state === "recording") {
            recorder.pause();
            this.pausedForBackpressure = true;
          }
          void this.drainPendingChunks();
        } else {
          this.chunks.push(event.data);
        }
      }
    };
    this.stopPromise = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener(
        "error",
        () => {
          if (recorder.state === "inactive") return;
          try {
            recorder.stop();
          } catch {
            // The stop event still resolves the buffered session when Chromium
            // has already moved the recorder to inactive.
          }
        },
        { once: true },
      );
    });

    try {
      recorder.start(250);
    } catch (error) {
      this.mediaRecorder = undefined;
      this.stopPromise = undefined;
      this.chunks = [];
      this.pendingChunks = [];
      this.pendingBytes = 0;
      this.chunkWriter = undefined;
      this.drainPromise = undefined;
      this.streamError = undefined;
      this.pausedForBackpressure = false;
      this.startedAt = 0;
      throw error;
    }
  }

  async stop(): Promise<{ blob?: Blob; mimeType: string; durationMs: number }> {
    if (!this.mediaRecorder) {
      throw new Error("录音尚未开始。");
    }

    const recorder = this.mediaRecorder;
    const stopped = this.stopPromise;
    if (!stopped) {
      throw new Error("录音会话状态异常，无法取得已经录制的内容。");
    }

    if (recorder.state === "paused") {
      recorder.resume();
      this.pausedForBackpressure = false;
    }
    if (recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    }
    await stopped;
    await this.drainPromise;
    const streamError = this.streamError;

    const mimeType = recorder.mimeType || this.capability.mimeType || "application/octet-stream";
    const chunks = this.chunks;
    const isStreaming = Boolean(this.chunkWriter);
    const durationMs = Math.max(0, Date.now() - this.startedAt);

    if (this.mediaRecorder === recorder) {
      this.mediaRecorder = undefined;
      this.stopPromise = undefined;
      this.chunks = [];
      this.pendingChunks = [];
      this.pendingBytes = 0;
      this.chunkWriter = undefined;
      this.drainPromise = undefined;
      this.streamError = undefined;
      this.pausedForBackpressure = false;
      this.startedAt = 0;
    }

    if (streamError) throw streamError;

    return {
      blob: isStreaming ? undefined : new Blob(chunks, { type: mimeType }),
      mimeType,
      durationMs,
    };
  }

  private drainPendingChunks(): Promise<void> {
    if (this.drainPromise || !this.chunkWriter) return this.drainPromise ?? Promise.resolve();
    const writer = this.chunkWriter;
    this.drainPromise = (async () => {
      while (this.pendingChunks.length > 0) {
        const chunk = this.pendingChunks.shift();
        if (!chunk) continue;
        this.pendingBytes = Math.max(0, this.pendingBytes - chunk.size);
        try {
          await writer(await chunk.arrayBuffer());
        } catch (error) {
          this.streamError =
            error instanceof Error ? error : new Error("recording_chunk_write_failed");
          this.pendingChunks = [];
          this.pendingBytes = 0;
          if (this.mediaRecorder?.state === "recording" || this.mediaRecorder?.state === "paused") {
            try {
              this.mediaRecorder.stop();
            } catch {
              // The stop event is already responsible for releasing the session.
            }
          }
          break;
        }
        if (
          this.pausedForBackpressure &&
          this.pendingBytes <= this.resumePendingBytes &&
          this.mediaRecorder?.state === "paused"
        ) {
          this.pausedForBackpressure = false;
          this.mediaRecorder.resume();
        }
      }
    })().finally(() => {
      this.drainPromise = undefined;
      if (this.pendingChunks.length > 0 && !this.streamError) void this.drainPendingChunks();
    });
    return this.drainPromise;
  }
}
