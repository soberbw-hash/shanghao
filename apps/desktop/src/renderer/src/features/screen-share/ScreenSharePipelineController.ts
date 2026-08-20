import type {
  MeshPeerConnection,
  ScreenShareEncodingProfile,
  ScreenShareReceiverStats,
  ScreenShareSenderStats,
} from "@private-voice/webrtc";
import {
  clearScreenSharePresentation,
  readScreenSharePresentation,
} from "./screenSharePresentationMetrics";

const FALLBACK_WARNING_MS = 8_000;

export interface ScreenSharePresentationStats {
  framesPerSecond?: number;
  width?: number;
  height?: number;
  sampledAt: number;
}

export interface ScreenSharePipelineSnapshot {
  requested?: {
    width: number;
    height: number;
    framesPerSecond: number;
    maxBitrateBps: number;
  };
  capture?: {
    width?: number;
    height?: number;
    framesPerSecond?: number;
  };
  send: Record<string, ScreenShareSenderStats>;
  receive: Record<string, ScreenShareReceiverStats>;
  present: Record<string, ScreenSharePresentationStats>;
  fallback: {
    active: boolean;
    targetCount: number;
    activeForMs: number;
    overdue: boolean;
  };
  updatedAt: number;
}

/** Collects capture -> encode/send -> decode -> present evidence without changing transport. */
export class ScreenSharePipelineController {
  private requested?: ScreenSharePipelineSnapshot["requested"];
  private capture?: ScreenSharePipelineSnapshot["capture"];
  private send: Record<string, ScreenShareSenderStats> = {};
  private receive: Record<string, ScreenShareReceiverStats> = {};
  private present: Record<string, ScreenSharePresentationStats> = {};
  private fallbackStartedAt?: number;
  private fallbackTargetCount = 0;
  private updatedAt = Date.now();

  setLocalCapture(track: MediaStreamTrack, profile: ScreenShareEncodingProfile): void {
    const settings = track.getSettings();
    this.requested = {
      width: profile.maxWidth,
      height: profile.maxHeight,
      framesPerSecond: profile.maxFramerate,
      maxBitrateBps: profile.maxBitrate,
    };
    this.capture = {
      width: settings.width,
      height: settings.height,
      framesPerSecond: settings.frameRate,
    };
    this.updatedAt = Date.now();
  }

  clearLocalCapture(): void {
    this.requested = undefined;
    this.capture = undefined;
    this.send = {};
    this.updatedAt = Date.now();
  }

  setFallback(active: boolean, targetCount: number): void {
    if (active && this.fallbackStartedAt === undefined) this.fallbackStartedAt = Date.now();
    if (!active) this.fallbackStartedAt = undefined;
    this.fallbackTargetCount = targetCount;
    this.updatedAt = Date.now();
  }

  clearPeer(peerId: string): void {
    delete this.send[peerId];
    delete this.receive[peerId];
    delete this.present[peerId];
    clearScreenSharePresentation(peerId);
    this.updatedAt = Date.now();
  }

  async sample(
    peers: ReadonlyMap<string, MeshPeerConnection>,
    remoteSharingPeerIds: ReadonlySet<string>,
  ): Promise<void> {
    const sendEntries = await Promise.all(
      [...peers].map(
        async ([peerId, peer]) =>
          [peerId, await peer.getScreenShareSenderStats().catch(() => undefined)] as const,
      ),
    );
    const receiveEntries = await Promise.all(
      [...peers]
        .filter(([peerId]) => remoteSharingPeerIds.has(peerId))
        .map(
          async ([peerId, peer]) =>
            [peerId, await peer.getScreenShareReceiverStats().catch(() => undefined)] as const,
        ),
    );
    this.send = Object.fromEntries(
      sendEntries.filter((entry): entry is readonly [string, ScreenShareSenderStats] =>
        Boolean(entry[1]),
      ),
    );
    this.receive = Object.fromEntries(
      receiveEntries.filter((entry): entry is readonly [string, ScreenShareReceiverStats] =>
        Boolean(entry[1]),
      ),
    );
    this.present = readScreenSharePresentation();
    this.updatedAt = Date.now();
  }

  snapshot(now = Date.now()): ScreenSharePipelineSnapshot {
    const activeForMs = this.fallbackStartedAt ? Math.max(0, now - this.fallbackStartedAt) : 0;
    return {
      requested: this.requested,
      capture: this.capture,
      send: { ...this.send },
      receive: { ...this.receive },
      present: { ...this.present },
      fallback: {
        active: this.fallbackStartedAt !== undefined,
        targetCount: this.fallbackTargetCount,
        activeForMs,
        overdue: activeForMs >= FALLBACK_WARNING_MS,
      },
      updatedAt: this.updatedAt,
    };
  }

  clear(): void {
    this.requested = undefined;
    this.capture = undefined;
    this.send = {};
    this.receive = {};
    this.present = {};
    clearScreenSharePresentation();
    this.fallbackStartedAt = undefined;
    this.fallbackTargetCount = 0;
    this.updatedAt = Date.now();
  }
}
