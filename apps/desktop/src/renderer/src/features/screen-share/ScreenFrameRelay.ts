import type { SignalEnvelope } from "@private-voice/signaling";

import { rendererPerformanceMonitor } from "../diagnostics/rendererPerformanceMonitor";

const MAX_WIDTH = 1_280;
const MAX_BYTES = 180 * 1024;
const FRAME_ENCODINGS = [
  { width: 1_280, quality: 0.72 },
  { width: 960, quality: 0.66 },
  { width: 720, quality: 0.58 },
  { width: 480, quality: 0.48 },
] as const;

interface ScreenFrameRelayOptions {
  roomId: string;
  peerId: string;
  getTargetPeerIds: () => string[];
  send: (payload: SignalEnvelope) => Promise<void>;
}

export class ScreenFrameRelay {
  private video?: HTMLVideoElement;
  private canvas?: HTMLCanvasElement;
  private timer?: number;
  private intervalMs?: number;
  private sequence = 0;
  private captureInFlight = false;

  constructor(private readonly options: ScreenFrameRelayOptions) {}

  isActive(): boolean {
    return this.timer !== undefined;
  }

  isRunningAt(intervalMs: number): boolean {
    return this.isActive() && this.intervalMs === intervalMs;
  }

  start(stream: MediaStream, intervalMs: number): void {
    this.stop();
    if (!stream.getVideoTracks()[0]) return;

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.video = video;
    this.canvas = document.createElement("canvas");
    this.intervalMs = intervalMs;
    video.addEventListener("loadeddata", () => void this.captureAndSend(), { once: true });
    void video.play().catch(() => undefined);
    void this.captureAndSend();
  }

  stop(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.intervalMs = undefined;
    this.captureInFlight = false;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = undefined;
    this.canvas = undefined;
  }

  private async captureAndSend(): Promise<void> {
    if (this.captureInFlight) return;
    this.captureInFlight = true;
    const captureStartedAt = performance.now();
    const video = this.video;
    const canvas = this.canvas;
    const targetPeerIds = this.options.getTargetPeerIds();
    try {
      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (targetPeerIds.length === 0) {
        this.stop();
        return;
      }

      const sourceWidth = video.videoWidth || 1280;
      const sourceHeight = video.videoHeight || 720;
      let encodedFrame: { data: string; width: number; height: number } | undefined;
      for (const encoding of FRAME_ENCODINGS) {
        const width = Math.min(MAX_WIDTH, encoding.width, sourceWidth);
        const height = Math.max(1, Math.round((width / sourceWidth) * sourceHeight));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) return;
        context.drawImage(video, 0, 0, width, height);
        // WebP keeps the current readable 720p/1280px fallback while making 24 FPS practical
        // inside the signaling frame-size ceiling.
        const data = canvas.toDataURL("image/webp", encoding.quality);
        if (new TextEncoder().encode(data).byteLength <= MAX_BYTES) {
          encodedFrame = { data, width, height };
          break;
        }
      }
      if (!encodedFrame) return;

      rendererPerformanceMonitor.recordLongTask("canvas", performance.now() - captureStartedAt);

      await this.options.send({
        type: "screen_frame",
        roomId: this.options.roomId,
        peerId: this.options.peerId,
        sourcePeerId: this.options.peerId,
        sequence: ++this.sequence,
        sentAt: Date.now(),
        width: encodedFrame.width,
        height: encodedFrame.height,
        data: encodedFrame.data,
        targetPeerIds,
      });
    } finally {
      this.captureInFlight = false;
      if (
        this.video &&
        this.intervalMs !== undefined &&
        this.options.getTargetPeerIds().length > 0
      ) {
        const elapsedMs = performance.now() - captureStartedAt;
        this.timer = window.setTimeout(
          () => {
            this.timer = undefined;
            void this.captureAndSend();
          },
          Math.max(0, this.intervalMs - elapsedMs),
        );
      }
    }
  }
}
