import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

import { DetachedScreenSharePublisher } from "./DetachedScreenSharePublisher";
import {
  SCREEN_SHARE_PROFILES,
  type ScreenShareDisplayMode,
  type ScreenShareItem,
  type ScreenShareManagerSnapshot,
  type StartScreenShareRequest,
} from "./types";

interface ScreenShareManagerOptions {
  startPublishing: (stream: MediaStream, profile: ScreenShareEncodingProfile) => Promise<void>;
  stopPublishing: () => Promise<void>;
  onSourceEnded?: () => void;
  writeLog?: (
    level: "info" | "warn" | "error",
    message: string,
    context?: Record<string, unknown>,
  ) => Promise<void>;
}

type ScreenShareListener = (snapshot: ScreenShareManagerSnapshot) => void;

const initialSnapshot: ScreenShareManagerSnapshot = {
  status: "idle",
  sources: [],
  quality: "720p",
  hasSystemAudio: false,
  displayMode: "inline",
};

export class ScreenShareManager {
  private options: ScreenShareManagerOptions;
  private snapshot: ScreenShareManagerSnapshot = initialSnapshot;
  private readonly listeners = new Set<ScreenShareListener>();
  private detachedPublisher?: DetachedScreenSharePublisher;
  private detachedSessionId?: string;
  private operationId = 0;
  private isDisposed = false;

  constructor(options: ScreenShareManagerOptions) {
    this.options = options;
  }

  updateOptions(options: ScreenShareManagerOptions): void {
    this.options = options;
  }

  getSnapshot(): ScreenShareManagerSnapshot {
    return this.snapshot;
  }

  subscribe(listener: ScreenShareListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async openSourcePicker(): Promise<void> {
    const operationId = ++this.operationId;
    this.patch({ status: "enumerating", error: undefined });
    try {
      const sources = await window.desktopApi.screenCapture.listSources();
      if (operationId !== this.operationId || this.isDisposed) return;
      if (sources.length === 0) throw new Error("screen_source_missing");
      this.patch({ status: "source-ready", sources });
    } catch (error) {
      if (operationId !== this.operationId || this.isDisposed) return;
      this.patch({ status: "failed", error: this.errorMessage(error) });
      await this.log("error", "Failed to enumerate screen capture sources", error);
      throw error;
    }
  }

  async startShare(request: StartScreenShareRequest): Promise<MediaStream> {
    if (this.snapshot.localStream) {
      throw new Error("screen_share_already_active");
    }
    const operationId = ++this.operationId;
    this.patch({
      status: "starting",
      selectedSourceId: request.sourceId,
      quality: request.quality,
      error: undefined,
    });

    let stream: MediaStream | undefined;
    try {
      const profile = SCREEN_SHARE_PROFILES[request.quality];
      await window.desktopApi.screenCapture.selectSource(request.sourceId);
      await window.desktopApi.screenCapture.setContentProtection(true);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: profile.maxWidth, max: profile.maxWidth },
          height: { ideal: profile.maxHeight, max: profile.maxHeight },
          frameRate: {
            ideal: Math.max(10, profile.maxFramerate - 3),
            max: profile.maxFramerate,
          },
        },
        audio: request.includeSystemAudio,
      });
      if (operationId !== this.operationId || this.isDisposed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("screen_share_superseded");
      }

      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack) throw new Error("screen_track_missing");
      await this.options.startPublishing(stream, profile);
      if (operationId !== this.operationId || this.isDisposed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("screen_share_superseded");
      }

      videoTrack.addEventListener(
        "ended",
        () => {
          if (this.snapshot.localStream !== stream || this.isDisposed) return;
          this.options.onSourceEnded?.();
          void this.stopShare("source-ended");
        },
        { once: true },
      );
      this.patch({
        status: "sharing",
        localStream: stream,
        hasSystemAudio: stream.getAudioTracks().some((track) => track.readyState === "live"),
      });
      await this.log("info", "Screen share started", {
        quality: request.quality,
        hasSystemAudio: this.snapshot.hasSystemAudio,
        videoTrackSettings: videoTrack.getSettings(),
      });
      return stream;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      await window.desktopApi.screenCapture.setContentProtection(false).catch(() => undefined);
      if (operationId === this.operationId && !this.isDisposed) {
        this.patch({
          status: "failed",
          localStream: undefined,
          hasSystemAudio: false,
          error: this.errorMessage(error),
        });
      }
      await this.log("error", "Screen share request failed", error);
      throw error;
    }
  }

  async stopShare(reason = "user"): Promise<void> {
    const operationId = ++this.operationId;
    const previousStream = this.snapshot.localStream;
    if (!previousStream && this.snapshot.status === "idle") return;
    this.patch({ status: "stopping" });
    try {
      await this.options.stopPublishing();
    } finally {
      previousStream?.getTracks().forEach((track) => track.stop());
      await window.desktopApi.screenCapture.setContentProtection(false).catch(() => undefined);
      this.closeDetachedViewer();
      if (operationId === this.operationId && !this.isDisposed) {
        this.patch({
          status: "idle",
          localStream: undefined,
          hasSystemAudio: false,
          selectedSourceId: undefined,
          displayMode: "inline",
        });
      }
      await this.log("info", "Screen share stopped", { reason });
    }
  }

  async openDetachedViewer(item: ScreenShareItem): Promise<void> {
    this.closeDetachedPublisher(false);
    const sessionId = crypto.randomUUID();
    this.detachedSessionId = sessionId;
    await window.desktopApi.screenShareViewer.open({ title: item.title, sessionId });
    this.patch({ displayMode: "detached", detachedItemId: item.id });

    if (item.stream) {
      const publisher = new DetachedScreenSharePublisher({
        sessionId,
        title: item.title,
        stream: item.stream,
        onClosed: () => this.closeDetachedViewer(),
      });
      this.detachedPublisher = publisher;
      publisher.start();
      return;
    }
    await this.sendFallbackFrame(item);
  }

  async syncDetachedItem(item?: ScreenShareItem): Promise<void> {
    if (!this.detachedSessionId) return;
    if (!item || item.id !== this.snapshot.detachedItemId) {
      this.closeDetachedViewer();
      return;
    }
    if (item.frameDataUrl) await this.sendFallbackFrame(item);
  }

  setDisplayMode(mode: ScreenShareDisplayMode): void {
    if (mode === "inline") this.closeDetachedViewer();
    else this.patch({ displayMode: mode });
  }

  closeDetachedViewer(): void {
    this.closeDetachedPublisher(true);
    this.detachedSessionId = undefined;
    void window.desktopApi.screenShareViewer.close().catch(() => undefined);
    this.patch({ displayMode: "inline", detachedItemId: undefined });
  }

  destroy(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.operationId += 1;
    if (this.snapshot.localStream) {
      void this.options.stopPublishing().catch(() => undefined);
    }
    this.stopLocalTracks();
    this.closeDetachedPublisher(true);
    this.detachedSessionId = undefined;
    void window.desktopApi.screenCapture.setContentProtection(false).catch(() => undefined);
    void window.desktopApi.screenShareViewer.close().catch(() => undefined);
    this.listeners.clear();
  }

  private async sendFallbackFrame(item: ScreenShareItem): Promise<void> {
    if (!this.detachedSessionId || !item.frameDataUrl) return;
    await window.desktopApi.screenShareViewer.sendSignal({
      sessionId: this.detachedSessionId,
      sender: "host",
      type: "fallback-frame",
      title: item.title,
      frameDataUrl: item.frameDataUrl,
    });
  }

  private closeDetachedPublisher(notifyViewer: boolean): void {
    this.detachedPublisher?.destroy(notifyViewer);
    this.detachedPublisher = undefined;
  }

  private stopLocalTracks(): void {
    this.snapshot.localStream?.getTracks().forEach((track) => track.stop());
  }

  private patch(patch: Partial<ScreenShareManagerSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async log(
    level: "info" | "warn" | "error",
    message: string,
    context?: unknown,
  ): Promise<void> {
    const normalizedContext =
      context instanceof Error
        ? {
            error: context.message,
            name: context.name,
            stack: context.stack,
          }
        : context && typeof context === "object"
          ? (context as Record<string, unknown>)
          : { detail: String(context ?? "") };
    await this.options
      .writeLog?.(level, message, {
        ...normalizedContext,
        managerStatus: this.snapshot.status,
      })
      .catch(() => undefined);
  }
}
