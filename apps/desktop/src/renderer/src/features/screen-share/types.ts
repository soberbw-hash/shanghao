import type { ScreenCaptureSourceDescriptor } from "@private-voice/shared";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

export type ScreenShareQuality = "720p" | "1080p" | "1440p";

export const SCREEN_SHARE_PROFILES: Record<ScreenShareQuality, ScreenShareEncodingProfile> = {
  "720p": {
    maxBitrate: 3_000_000,
    maxFramerate: 30,
    maxWidth: 1_280,
    maxHeight: 720,
  },
  "1080p": {
    maxBitrate: 6_000_000,
    maxFramerate: 30,
    maxWidth: 1_920,
    maxHeight: 1_080,
  },
  "1440p": {
    maxBitrate: 10_000_000,
    maxFramerate: 30,
    maxWidth: 2_560,
    maxHeight: 1_440,
  },
};

export const DEFAULT_SCREEN_SHARE_QUALITY: ScreenShareQuality = "1080p";

export type ScreenShareManagerStatus =
  "idle" | "enumerating" | "source-ready" | "starting" | "sharing" | "stopping" | "failed";

export type ScreenShareDisplayMode = "inline" | "detached";

export interface ScreenShareTransitionOrigin {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface ScreenShareItem {
  id: string;
  title: string;
  stream?: MediaStream;
  frameDataUrl?: string;
  frameWidth?: number;
  frameHeight?: number;
  isLocal?: boolean;
  quality?: ScreenShareQuality;
  transport: "webrtc" | "relay";
}

export interface ScreenShareManagerSnapshot {
  status: ScreenShareManagerStatus;
  sources: ScreenCaptureSourceDescriptor[];
  selectedSourceId?: string;
  localStream?: MediaStream;
  hasSystemAudio: boolean;
  requestedQuality: ScreenShareQuality;
  capture?: {
    width?: number;
    height?: number;
    framesPerSecond?: number;
  };
  displayMode: ScreenShareDisplayMode;
  detachedItemId?: string;
  transitionOrigin?: ScreenShareTransitionOrigin;
  error?: string;
}

export interface StartScreenShareRequest {
  sourceId: string;
  includeSystemAudio: boolean;
  quality?: ScreenShareQuality;
  transitionOrigin?: ScreenShareTransitionOrigin;
}
