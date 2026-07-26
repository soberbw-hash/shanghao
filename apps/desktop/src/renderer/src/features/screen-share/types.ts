import type { ScreenCaptureSourceDescriptor, ScreenShareQuality } from "@private-voice/shared";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

export const SCREEN_SHARE_PROFILES: Record<ScreenShareQuality, ScreenShareEncodingProfile> = {
  "720p": {
    maxBitrate: 360_000,
    maxFramerate: 15,
    maxWidth: 1_280,
    maxHeight: 720,
  },
  "1080p": {
    maxBitrate: 650_000,
    maxFramerate: 18,
    maxWidth: 1_920,
    maxHeight: 1_080,
  },
};

export type ScreenShareManagerStatus =
  "idle" | "enumerating" | "source-ready" | "starting" | "sharing" | "stopping" | "failed";

export type ScreenShareDisplayMode = "inline" | "detached";

export interface ScreenShareItem {
  id: string;
  title: string;
  stream?: MediaStream;
  frameDataUrl?: string;
  isLocal?: boolean;
  transport: "webrtc" | "relay";
}

export interface ScreenShareManagerSnapshot {
  status: ScreenShareManagerStatus;
  sources: ScreenCaptureSourceDescriptor[];
  selectedSourceId?: string;
  localStream?: MediaStream;
  quality: ScreenShareQuality;
  hasSystemAudio: boolean;
  displayMode: ScreenShareDisplayMode;
  detachedItemId?: string;
  error?: string;
}

export interface StartScreenShareRequest {
  sourceId: string;
  quality: ScreenShareQuality;
  includeSystemAudio: boolean;
}
