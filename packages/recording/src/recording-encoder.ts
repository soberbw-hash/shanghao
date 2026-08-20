import type { RecordingCapability } from "@private-voice/shared";

export interface RecordingEncoder {
  readonly capability: RecordingCapability;
  hasRecording: () => boolean;
  start: (stream: MediaStream) => void;
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
}

export class BrowserRecordingEncoder implements RecordingEncoder {
  readonly capability: RecordingCapability;
  private mediaRecorder?: MediaRecorder;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private stopPromise?: Promise<void>;

  hasRecording(): boolean {
    return Boolean(this.mediaRecorder);
  }

  constructor(capability: RecordingCapability) {
    this.capability = capability;
  }

  start(stream: MediaStream): void {
    if (!this.capability.mimeType) {
      throw new Error("当前设备没有检测到可用的录音 MIME 类型。");
    }

    if (this.mediaRecorder) {
      throw new Error("已有录音正在进行，请先结束当前录音。");
    }

    this.chunks = [];
    this.startedAt = Date.now();
    const recorder = new MediaRecorder(stream, {
      mimeType: this.capability.mimeType,
      audioBitsPerSecond: 160_000,
    });
    this.mediaRecorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
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
      this.startedAt = 0;
      throw error;
    }
  }

  async stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number }> {
    if (!this.mediaRecorder) {
      throw new Error("录音尚未开始。");
    }

    const recorder = this.mediaRecorder;
    const stopped = this.stopPromise;
    if (!stopped) {
      throw new Error("录音会话状态异常，无法取得已经录制的内容。");
    }

    if (recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    }
    await stopped;

    const mimeType = recorder.mimeType || this.capability.mimeType || "application/octet-stream";
    const chunks = this.chunks;
    const durationMs = Math.max(0, Date.now() - this.startedAt);

    if (this.mediaRecorder === recorder) {
      this.mediaRecorder = undefined;
      this.stopPromise = undefined;
      this.chunks = [];
      this.startedAt = 0;
    }

    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      durationMs,
    };
  }
}
