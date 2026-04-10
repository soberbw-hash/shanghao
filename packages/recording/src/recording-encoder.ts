import type { RecordingCapability } from "@private-voice/shared";

export interface RecordingEncoder {
  readonly capability: RecordingCapability;
  start: (stream: MediaStream) => void;
  stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
}

export class BrowserRecordingEncoder implements RecordingEncoder {
  readonly capability: RecordingCapability;
  private mediaRecorder?: MediaRecorder;
  private chunks: BlobPart[] = [];
  private startedAt = 0;

  constructor(capability: RecordingCapability) {
    this.capability = capability;
  }

  start(stream: MediaStream): void {
    if (!this.capability.mimeType) {
      throw new Error("当前设备没有检测到可用的录音 MIME 类型。");
    }

    this.chunks = [];
    this.startedAt = Date.now();
    this.mediaRecorder = new MediaRecorder(stream, {
      mimeType: this.capability.mimeType,
      audioBitsPerSecond: 160_000,
    });
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    };
    this.mediaRecorder.start(250);
  }

  async stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number }> {
    if (!this.mediaRecorder) {
      throw new Error("录音尚未开始。");
    }

    const recorder = this.mediaRecorder;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    const mimeType = recorder.mimeType || this.capability.mimeType || "application/octet-stream";

    return {
      blob: new Blob(this.chunks, { type: mimeType }),
      mimeType,
      durationMs: Date.now() - this.startedAt,
    };
  }
}
