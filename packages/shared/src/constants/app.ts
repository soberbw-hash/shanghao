export const APP_NAME = "\u4E0A\u53F7";
export const APP_SLOGAN = "\u66F4\u597D\u7684\u5F00\u9ED1\u8BED\u97F3";
export const APP_ID = "com.sober.shanghao";
export const DEFAULT_ROOM_NAME = "\u5F00\u9ED1\u9891\u9053";
export const DEFAULT_CHANNEL_ID = "main";
export const MAX_ROOM_MEMBERS = 5;
export const MAX_ROOM_COLLECTION_TEXT_LENGTH = 2_000;
export const MAX_ROOM_COLLECTION_IMAGE_LENGTH = 180_000;
export const TARGET_SAMPLE_RATE = 32_000;
export const MICROPHONE_PROCESSING_SAMPLE_RATE = 48_000;
export const TARGET_CHANNEL_COUNT = 1;
export const HEARTBEAT_INTERVAL_MS = 10_000;
export const SIGNALING_PING_TIMEOUT_MS = 30_000;
export const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 12_000, 16_000];
export const DEFAULT_SIGNALING_PORT = 43_821;
// 2.6 only adds optional message fields and request types. Keep protocol 7 so
// existing 2.5 clients can still share the fixed server while people update.
export const APP_PROTOCOL_VERSION = "7";
export const APP_BUILD_NUMBER = "2026.08.20.1";
export const SETTINGS_SCHEMA_VERSION = 26;
export const PROFILE_SCHEMA_VERSION = 2;
export const DEFAULT_RELEASES_URL = "https://github.com/soberbw-hash/shanghao/releases";

export const LOG_CATEGORIES = [
  "app",
  "renderer-startup",
  "signaling",
  "webrtc",
  "audio",
  "devices",
  "recording",
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
