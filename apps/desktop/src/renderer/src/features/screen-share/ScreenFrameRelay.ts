import type { SignalEnvelope } from "@private-voice/signaling";

const MAX_WIDTH = 480;
const MAX_BYTES = 48 * 1024;

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
    this.timer = window.setInterval(() => void this.captureAndSend(), intervalMs);
    void this.captureAndSend();
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.intervalMs = undefined;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = undefined;
    this.canvas = undefined;
  }

  private async captureAndSend(): Promise<void> {
    const video = this.video;
    const canvas = this.canvas;
    const targetPeerIds = this.options.getTargetPeerIds();
    if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (targetPeerIds.length === 0) {
      this.stop();
      return;
    }

    const sourceWidth = video.videoWidth || 1280;
    const sourceHeight = video.videoHeight || 720;
    let width = Math.min(MAX_WIDTH, sourceWidth);
    let height = Math.max(1, Math.round((width / sourceWidth) * sourceHeight));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    context.drawImage(video, 0, 0, width, height);
    let data = canvas.toDataURL("image/jpeg", 0.38);
    if (new TextEncoder().encode(data).byteLength > MAX_BYTES) {
      width = Math.min(MAX_WIDTH, sourceWidth);
      height = Math.max(1, Math.round((width / sourceWidth) * sourceHeight));
      canvas.width = width;
      canvas.height = height;
      const retryContext = canvas.getContext("2d", { alpha: false });
      retryContext?.drawImage(video, 0, 0, width, height);
      data = canvas.toDataURL("image/jpeg", 0.26);
      if (new TextEncoder().encode(data).byteLength > MAX_BYTES) return;
    }

    await this.options.send({
      type: "screen_frame",
      roomId: this.options.roomId,
      peerId: this.options.peerId,
      sourcePeerId: this.options.peerId,
      sequence: ++this.sequence,
      sentAt: Date.now(),
      width,
      height,
      data,
      targetPeerIds,
    });
  }
}
