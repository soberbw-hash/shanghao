import type {
  AppSettings,
  ProfileAvatarSelection,
  UpdateCheckResult,
  UpdateStatus,
} from "./settings.types";
import type {
  DiagnosticsSnapshot,
  LogCategory,
  LogEntry,
  RendererDiagnosticsSummary,
} from "./diagnostics.types";
import type { RoomMember } from "./room.types";
import type {
  RecordingExportPayload,
  RecordingExportResponse,
} from "./recording.types";

export interface RuntimeInfo {
  appName: string;
  version: string;
  platform: string;
  protocolVersion: string;
  buildNumber: string;
}

export interface RendererLogPayload {
  category: LogCategory;
  level: LogEntry["level"];
  message: string;
  context?: Record<string, unknown>;
}

export interface SignalingEventPayload {
  type: "open" | "message" | "close" | "error";
  data?: string;
  code?: number;
  reason?: string;
  wasClean?: boolean;
  message?: string;
}

export interface LlmChatRequest {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface LlmChatResponse {
  ok: boolean;
  reply?: string;
  reason?: "not_configured" | "request_failed" | "empty";
}

export interface OverlayState {
  members: RoomMember[];
  isMuted: boolean;
  isDeafened: boolean;
  connectionState: string;
}

export interface GameDetectionSnapshot {
  gameName?: "失落城堡2" | "三角洲行动" | "英雄联盟" | "无畏契约" | "CS2" | "原神" | "永劫无间" | "Apex英雄" | "绝地求生" | "守望先锋" | "蛋仔派对" | "我的世界" | "Roblox";
  detectedAt?: string;
  checkedAt: string;
}

export interface DesktopApi {
  app: {
    getRuntimeInfo: () => Promise<RuntimeInfo>;
    writeLog: (payload: RendererLogPayload) => Promise<void>;
    openPath: (targetPath: string) => Promise<void>;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };
  window: {
    minimize: () => Promise<void>;
    hide: () => Promise<void>;
    close: () => Promise<void>;
    show: () => Promise<void>;
  };
  overlay: {
    toggle: () => Promise<boolean>;
    close: () => Promise<void>;
    update: (state: OverlayState) => Promise<void>;
    onState: (listener: (state: OverlayState) => void) => () => void;
  };
  games: {
    getSnapshot: () => Promise<GameDetectionSnapshot>;
    onDetected: (listener: (snapshot: GameDetectionSnapshot) => void) => () => void;
  };
  settings: {
    get: () => Promise<AppSettings>;
    save: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    reset: () => Promise<AppSettings>;
  };
  profile: {
    pickAvatar: () => Promise<ProfileAvatarSelection | undefined>;
    readAvatar: (avatarPath?: string) => Promise<string | undefined>;
    clearAvatar: (avatarPath?: string) => Promise<void>;
  };
  diagnostics: {
    snapshot: () => Promise<DiagnosticsSnapshot>;
    exportLogs: () => Promise<DiagnosticsSnapshot>;
    exportBundle: (rendererState?: RendererDiagnosticsSummary) => Promise<DiagnosticsSnapshot>;
    openLogsDirectory: () => Promise<void>;
  };
  shortcuts: {
    configureMute: (accelerator: string) => Promise<void>;
    onMuteTriggered: (listener: () => void) => () => void;
  };
  updates: {
    check: () => Promise<UpdateCheckResult>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    onStatus: (listener: (status: UpdateStatus) => void) => () => void;
    openReleases: () => Promise<void>;
  };
  signaling: {
    connect: (signalingUrl: string) => Promise<void>;
    send: (payload: string) => Promise<void>;
    close: () => Promise<void>;
    onEvent: (listener: (payload: SignalingEventPayload) => void) => () => void;
  };
  recording: {
    export: (
      payload: RecordingExportPayload,
    ) => Promise<RecordingExportResponse>;
  };
  llm: {
    chat: (payload: LlmChatRequest) => Promise<LlmChatResponse>;
    health: () => Promise<{ ok: boolean; configured: boolean; reason?: string }>;
  };
}
