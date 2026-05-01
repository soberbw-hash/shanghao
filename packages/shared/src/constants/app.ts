export const APP_NAME = "\u4E0A\u53F7";
export const APP_SLOGAN = "\u66F4\u597D\u7684\u5F00\u9ED1\u8BED\u97F3";
export const APP_ID = "com.sober.shanghao";
export const DEFAULT_ROOM_NAME = "\u4E0A\u53F7\u623F\u95F4";
export const MAX_ROOM_MEMBERS = 5;
export const TARGET_SAMPLE_RATE = 44_100;
export const TARGET_CHANNEL_COUNT = 1;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const SIGNALING_PING_TIMEOUT_MS = 30_000;
export const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000];
export const DEFAULT_SIGNALING_PORT = 43_821;
export const APP_PROTOCOL_VERSION = "1";
export const APP_BUILD_NUMBER = "2026.05.01.2";
export const SETTINGS_SCHEMA_VERSION = 3;
export const DEFAULT_RELEASES_URL = "https://github.com/soberbw-hash/shanghao/releases";

export const LOG_CATEGORIES = [
  "app",
  "renderer-startup",
  "signaling",
  "webrtc",
  "audio",
  "devices",
  "recording",
  "tailscale",
  "connection-mode",
  "proxy-diagnostics",
  "relay",
  "updates",
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
