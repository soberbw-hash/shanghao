import type { ScreenCaptureSourceDescriptor } from "@private-voice/shared";
import type { ScreenShareEncodingProfile } from "@private-voice/webrtc";

export const SCREEN_SHARE_PROFILE: ScreenShareEncodingProfile = {
  maxBitrate: 2_400_000,
  maxFramerate: 24,
  maxWidth: 2_560,
  maxHeight: 1_440,
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
  hasSystemAudio: boolean;
  displayMode: ScreenShareDisplayMode;
  detachedItemId?: string;
  error?: string;
}

export interface StartScreenShareRequest {
  sourceId: string;
  includeSystemAudio: boolean;
}
