export const APP_NAME = "Quiet Team";
export const DEFAULT_ROOM_NAME = "Private Lounge";
export const MAX_ROOM_MEMBERS = 5;
export const TARGET_SAMPLE_RATE = 44_100;
export const TARGET_CHANNEL_COUNT = 1;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const SIGNALING_PING_TIMEOUT_MS = 30_000;
export const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
export const LOG_CATEGORIES = [
  "app",
  "signaling",
  "webrtc",
  "audio",
  "devices",
  "recording",
  "tailscale",
] as const;

export const DIRECT_AAC_MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/aac",
] as const;

export const FALLBACK_RECORDING_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;
