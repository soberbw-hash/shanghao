import type { ChronicleAudioPart } from "./RoomChronicleClient";

/** Records only the existing gated local voice track, independently of the recording library. */
export class ChronicleMicrophoneCapture {
  private recorder?: MediaRecorder;
  private timer?: ReturnType<typeof setTimeout>;
  private probe?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private captureRetry?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;
  private queue: Array<{ part: ChronicleAudioPart; expires: number }> = [];
  constructor(
    private readonly track: MediaStreamTrack,
    private readonly sessionId: string,
    private readonly speaking: () => boolean,
    private readonly send: (part: ChronicleAudioPart) => Promise<void>,
    private readonly status: (message: string) => void,
  ) {}

  start(): void {
    if (this.stopped || this.track.readyState !== "live") return;
    // An inactive encoder may still owe its final data and stop events.
    if (this.recorder) return;
    clearTimeout(this.captureRetry);
    try {
      const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"].find((mime) =>
        MediaRecorder.isTypeSupported(mime),
      );
      if (!mimeType) {
        this.status("当前设备不支持纪事音频编码");
        return;
      }
      const recorder = new MediaRecorder(new MediaStream([this.track]), {
        mimeType,
        audioBitsPerSecond: 24_000,
      });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      const start = performance.now();
      const startedAt = Date.now();
      let speech = false;
      let failed = false;
      this.probe = setInterval(() => {
        speech ||= this.track.enabled && this.speaking();
      }, 200);
      recorder.ondataavailable = (event) => {
        if (!this.stopped && this.recorder === recorder && event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        if (this.stopped || this.recorder !== recorder || failed) return;
        failed = true;
        this.status("纪事音频暂不可用，稍后自动再试");
        this.awaitStop(recorder);
      };
      recorder.onstop = () => {
        if (this.stopped || !this.releaseRecorder(recorder)) return;
        if (failed) {
          this.retryCapture();
          return;
        }
        const durationMs = Math.round(performance.now() - start);
        const blob = new Blob(chunks, { type: mimeType });
        if (
          speech &&
          durationMs >= 500 &&
          durationMs <= 45_000 &&
          blob.size > 0 &&
          blob.size <= 165_000
        ) {
          void this.enqueue(blob, durationMs, startedAt);
        }
        this.start();
      };
      recorder.start();
      this.timer = setTimeout(() => {
        if (this.stopped || this.recorder !== recorder) return;
        try {
          if (recorder.state !== "inactive") recorder.stop();
          // A broken encoder may never dispatch onstop. Do not leave capture wedged.
          if (this.recorder === recorder) this.awaitStop(recorder);
        } catch {
          this.failCapture(recorder);
        }
      }, 30_000);
    } catch {
      const recorder = this.recorder;
      if (recorder) this.failCapture(recorder);
      else {
        this.status("纪事音频暂不可用，稍后自动再试");
        this.retryCapture();
      }
    }
  }

  private releaseRecorder(recorder: MediaRecorder): boolean {
    if (this.recorder !== recorder) return false;
    clearTimeout(this.timer);
    clearInterval(this.probe);
    this.recorder = undefined;
    recorder.onstop = null;
    recorder.onerror = null;
    recorder.ondataavailable = null;
    return true;
  }

  private awaitStop(recorder: MediaRecorder): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.failCapture(recorder), 2_000);
  }

  private failCapture(recorder: MediaRecorder): void {
    if (this.stopped || !this.releaseRecorder(recorder)) return;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* Lost encoder. */
    }
    this.status("纪事音频暂不可用，稍后自动再试");
    this.retryCapture();
  }

  private retryCapture(): void {
    clearTimeout(this.captureRetry);
    if (!this.stopped) this.captureRetry = setTimeout(() => this.start(), 10_000);
  }

  private async enqueue(blob: Blob, durationMs: number, startedAt: number): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch {
      if (!this.stopped) this.status("一段纪事音频读取失败，后续会继续记录");
      return;
    }
    if (this.stopped) return;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    if (this.queue.length >= 3) this.queue.shift();
    this.queue.push({
      part: {
        sessionId: this.sessionId,
        chunkId: crypto.randomUUID(),
        durationMs,
        startedAt,
        mime: blob.type.startsWith("audio/ogg") ? "audio/ogg" : "audio/webm",
        data: btoa(binary),
      },
      expires: Date.now() + 120_000,
    });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.busy || this.stopped) return;
    while (this.queue[0] && this.queue[0].expires < Date.now()) this.queue.shift();
    const next = this.queue[0];
    if (!next) return;
    this.busy = true;
    let retry = false;
    try {
      await this.send(next.part);
      if (this.queue[0] === next) this.queue.shift();
      if (!this.stopped) this.status("正在记录，稍后汇总");
    } catch {
      retry = true;
      if (!this.stopped) this.status("连接恢复后自动继续");
    } finally {
      this.busy = false;
      if (!this.stopped)
        this.retry = setTimeout(
          () => {
            void this.drain();
          },
          retry ? 10_000 : 0,
        );
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.retry);
    clearTimeout(this.captureRetry);
    clearInterval(this.probe);
    const recorder = this.recorder;
    if (recorder && this.releaseRecorder(recorder)) {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* A lost encoder must not block withdrawal. */
      }
    }
    this.queue = [];
    // The voice track is owned by the room, never stop or clone it here.
  }
}
