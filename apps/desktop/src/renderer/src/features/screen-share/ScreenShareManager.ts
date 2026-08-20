import type { ScreenCaptureSourceDescriptor } from "@private-voice/shared";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

import { shanghaoCore } from "../../core/shanghaoCore";
import { DetachedScreenSharePublisher } from "./DetachedScreenSharePublisher";
import {
  DEFAULT_SCREEN_SHARE_QUALITY,
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
  hasSystemAudio: false,
  requestedQuality: DEFAULT_SCREEN_SHARE_QUALITY,
  displayMode: "inline",
};

const WINDOWS_CAPTURE_RETRY_DELAY_MS = 320;
const WINDOWS_LEGACY_CAPTURE_DELAY_MS = 680;

interface ElectronDesktopVideoConstraints extends MediaTrackConstraints {
  mandatory: {
    chromeMediaSource: "desktop";
    chromeMediaSourceId: string;
    maxWidth: number;
    maxHeight: number;
    maxFrameRate: number;
  };
}

export const isRetryableDisplayCaptureError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "NotReadableError" || error.name === "AbortError"
    : error instanceof Error &&
      (error.name === "NotReadableError" ||
        error.name === "AbortError" ||
        error.message.includes("Could not start video source"));

export class ScreenShareManager {
  private options: ScreenShareManagerOptions;
  private snapshot: ScreenShareManagerSnapshot = initialSnapshot;
  private readonly listeners = new Set<ScreenShareListener>();
  private detachedPublisher?: DetachedScreenSharePublisher;
  private detachedSessionId?: string;
  private operationId = 0;
  private isDisposed = false;
  private shutdownPromise?: Promise<void>;

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

  async openSourcePicker(): Promise<ScreenCaptureSourceDescriptor[]> {
    const operationId = ++this.operationId;
    this.patch({ status: "enumerating", error: undefined });
    try {
      await shanghaoCore.screenCapture.setContentProtection(false);
      const sources = await shanghaoCore.screenCapture.listSources({ timeoutMs: 8_000 });
      if (operationId !== this.operationId || this.isDisposed) {
        return [];
      }
      if (sources.length === 0) throw new Error("screen_source_missing");
      this.patch({ status: "source-ready", sources });
      return sources;
    } catch (error) {
      if (operationId !== this.operationId || this.isDisposed) {
        return [];
      }
      this.patch({ status: "failed", error: this.errorMessage(error) });
      await this.log("error", "Failed to enumerate screen capture sources", error);
      throw error;
    }
  }

  async cancelSourcePicker(): Promise<void> {
    if (!["enumerating", "source-ready", "failed"].includes(this.snapshot.status)) return;
    this.operationId += 1;
    this.patch({
      status: "idle",
      sources: [],
      selectedSourceId: undefined,
      error: undefined,
    });
    await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
    await this.log("info", "Screen source picker cancelled");
  }

  async startShare(request: StartScreenShareRequest): Promise<MediaStream> {
    if (this.snapshot.localStream) {
      throw new Error("screen_share_already_active");
    }
    const operationId = ++this.operationId;
    const quality = request.quality ?? DEFAULT_SCREEN_SHARE_QUALITY;
    const normalizedRequest: StartScreenShareRequest = { ...request, quality };
    this.patch({
      status: "starting",
      selectedSourceId: request.sourceId,
      requestedQuality: quality,
      error: undefined,
    });

    let stream: MediaStream | undefined;
    try {
      const profile = SCREEN_SHARE_PROFILES[quality];
      const requestStream = async (includeSystemAudio: boolean): Promise<MediaStream> => {
        await shanghaoCore.screenCapture.selectSource(request.sourceId);
        return navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: profile.maxWidth, max: profile.maxWidth },
            height: { ideal: profile.maxHeight, max: profile.maxHeight },
            frameRate: {
              ideal: profile.maxFramerate,
              max: profile.maxFramerate,
            },
          },
          audio: includeSystemAudio,
        });
      };
      const requestExactSourceFallback = async (): Promise<MediaStream> => {
        const video: ElectronDesktopVideoConstraints = {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: request.sourceId,
            maxWidth: profile.maxWidth,
            maxHeight: profile.maxHeight,
            maxFrameRate: profile.maxFramerate,
          },
        };
        return navigator.mediaDevices.getUserMedia({
          // Electron explicitly supports DesktopCapturerSource ids through
          // chromeMediaSourceId. This bypasses Chromium's display-media broker when
          // a long-running Windows session leaves that broker unable to start a source.
          video: video as MediaTrackConstraints,
          audio: false,
        });
      };

      try {
        stream = await requestStream(request.includeSystemAudio);
      } catch (error) {
        if (!isRetryableDisplayCaptureError(error)) throw error;
        await this.log(
          "warn",
          "Windows screen capture source was temporarily unavailable; retrying",
          {
            sourceId: request.sourceId,
            includeSystemAudio: request.includeSystemAudio,
            error: this.errorMessage(error),
          },
        );
        await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
        await new Promise((resolve) => window.setTimeout(resolve, WINDOWS_CAPTURE_RETRY_DELAY_MS));
        try {
          stream = await requestStream(false);
        } catch (retryError) {
          if (!isRetryableDisplayCaptureError(retryError)) throw retryError;
          await this.log(
            "warn",
            "Windows display-media retry failed; using the exact desktop source fallback",
            {
              sourceId: request.sourceId,
              error: this.errorMessage(retryError),
            },
          );
          await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
          await new Promise((resolve) =>
            window.setTimeout(resolve, WINDOWS_LEGACY_CAPTURE_DELAY_MS),
          );
          stream = await requestExactSourceFallback();
          await this.log("info", "Exact desktop source fallback started", {
            sourceId: request.sourceId,
            systemAudioOmitted: request.includeSystemAudio,
          });
        }
      }
      if (operationId !== this.operationId || this.isDisposed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("screen_share_superseded");
      }

      const [videoTrack] = stream.getVideoTracks();
      if (!videoTrack) throw new Error("screen_track_missing");
      const captureSettings = videoTrack.getSettings();
      await this.options.startPublishing(stream, profile);
      if (operationId !== this.operationId || this.isDisposed) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("screen_share_superseded");
      }

      this.bindTrackRecovery(stream, normalizedRequest, profile);
      this.patch({
        status: "sharing",
        localStream: stream,
        hasSystemAudio: stream.getAudioTracks().some((track) => track.readyState === "live"),
        capture: {
          width: captureSettings.width,
          height: captureSettings.height,
          framesPerSecond: captureSettings.frameRate,
        },
      });
      await shanghaoCore.screenCapture.setContentProtection(true);
      await this.log("info", "Screen share started", {
        requestedQuality: quality,
        requestedWidth: profile.maxWidth,
        requestedHeight: profile.maxHeight,
        hasSystemAudio: this.snapshot.hasSystemAudio,
        videoTrackSettings: captureSettings,
      });
      return stream;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
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

    previousStream?.getTracks().forEach((track) => track.stop());
    this.closeDetachedViewer();
    if (operationId === this.operationId && !this.isDisposed) {
      this.patch({
        status: "idle",
        sources: [],
        localStream: undefined,
        hasSystemAudio: false,
        selectedSourceId: undefined,
        capture: undefined,
        displayMode: "inline",
        detachedItemId: undefined,
        error: undefined,
      });
    }

    try {
      await this.options.stopPublishing();
    } catch (error) {
      await this.log("warn", "Failed to stop publishing screen share cleanly", {
        reason,
        error: this.errorMessage(error),
      });
    }

    await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
    await this.log("info", "Screen share stopped", { reason });
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

  async shutdown(reason = "room-exit"): Promise<void> {
    if (this.isDisposed) return;
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = (async () => {
      try {
        await this.stopShare(reason);
      } catch (error) {
        await this.log("warn", "Screen share shutdown continued after stop failure", error);
      } finally {
        this.closeDetachedViewer();
        this.stopLocalTracks();
        await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
        if (!this.isDisposed) this.patch({ ...initialSnapshot });
      }
    })().finally(() => {
      this.shutdownPromise = undefined;
    });
    return this.shutdownPromise;
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
    void shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
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

  private bindTrackRecovery(
    stream: MediaStream,
    request: StartScreenShareRequest,
    profile: ScreenShareEncodingProfile,
  ): void {
    const [videoTrack] = stream.getVideoTracks();
    videoTrack?.addEventListener(
      "ended",
      () => {
        if (this.snapshot.localStream !== stream || this.isDisposed) return;
        void this.recoverEndedTrack(request, profile, stream);
      },
      { once: true },
    );
  }

  private async recoverEndedTrack(
    request: StartScreenShareRequest,
    profile: ScreenShareEncodingProfile,
    endedStream: MediaStream,
  ): Promise<void> {
    const operationId = ++this.operationId;
    this.patch({ status: "starting", error: undefined });
    await this.log("warn", "Screen share track ended; attempting one automatic recovery", {
      sourceId: request.sourceId,
      requestedQuality: request.quality,
    });
    await this.options.stopPublishing().catch(() => undefined);
    await new Promise((resolve) => window.setTimeout(resolve, WINDOWS_CAPTURE_RETRY_DELAY_MS));
    if (operationId !== this.operationId || this.isDisposed) return;

    let recoveredStream: MediaStream | undefined;
    try {
      await shanghaoCore.screenCapture.setContentProtection(false).catch(() => undefined);
      await shanghaoCore.screenCapture.selectSource(request.sourceId);
      try {
        recoveredStream = await navigator.mediaDevices.getDisplayMedia({
          video: {
            width: { ideal: profile.maxWidth, max: profile.maxWidth },
            height: { ideal: profile.maxHeight, max: profile.maxHeight },
            frameRate: { ideal: profile.maxFramerate, max: profile.maxFramerate },
          },
          audio: request.includeSystemAudio,
        });
      } catch (error) {
        if (!isRetryableDisplayCaptureError(error)) throw error;
        const video: ElectronDesktopVideoConstraints = {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: request.sourceId,
            maxWidth: profile.maxWidth,
            maxHeight: profile.maxHeight,
            maxFrameRate: profile.maxFramerate,
          },
        };
        recoveredStream = await navigator.mediaDevices.getUserMedia({
          video: video as MediaTrackConstraints,
          audio: false,
        });
      }
      if (operationId !== this.operationId || this.isDisposed) {
        recoveredStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const [videoTrack] = recoveredStream.getVideoTracks();
      if (!videoTrack) throw new Error("screen_track_missing_after_recovery");
      const captureSettings = videoTrack.getSettings();
      await this.options.startPublishing(recoveredStream, profile);
      endedStream.getTracks().forEach((track) => track.stop());
      this.bindTrackRecovery(recoveredStream, request, profile);
      this.patch({
        status: "sharing",
        localStream: recoveredStream,
        hasSystemAudio: recoveredStream
          .getAudioTracks()
          .some((track) => track.readyState === "live"),
        capture: {
          width: captureSettings.width,
          height: captureSettings.height,
          framesPerSecond: captureSettings.frameRate,
        },
      });
      await shanghaoCore.screenCapture.setContentProtection(true);
      await this.log("info", "Screen share track recovered", {
        requestedQuality: request.quality,
        videoTrackSettings: captureSettings,
      });
    } catch (error) {
      recoveredStream?.getTracks().forEach((track) => track.stop());
      if (operationId !== this.operationId || this.isDisposed) return;
      this.options.onSourceEnded?.();
      await this.log("error", "Screen share track recovery failed", error);
      await this.stopShare("source-ended-recovery-failed");
    }
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
