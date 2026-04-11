import type {
  AppSettings,
  NetworkStatusSnapshot,
  ProfileAvatarSelection,
  ProxyDiagnostics,
  TailscaleStatus,
} from "./settings.types";
import type { DiagnosticsSnapshot, LogCategory, LogEntry } from "./diagnostics.types";
import type {
  HostSessionInfo,
  JoinRoomDiagnostic,
} from "./room.types";
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

export interface DesktopApi {
  app: {
    getRuntimeInfo: () => Promise<RuntimeInfo>;
    writeLog: (payload: RendererLogPayload) => Promise<void>;
    openPath: (targetPath: string) => Promise<void>;
  };
  window: {
    minimize: () => Promise<void>;
    hide: () => Promise<void>;
    close: () => Promise<void>;
    show: () => Promise<void>;
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
    exportBundle: () => Promise<DiagnosticsSnapshot>;
    openLogsDirectory: () => Promise<void>;
  };
  shortcuts: {
    configureMute: (accelerator: string) => Promise<void>;
    onMuteTriggered: (listener: () => void) => () => void;
  };
  tailscale: {
    checkStatus: () => Promise<TailscaleStatus>;
    openInstallGuide: () => Promise<void>;
  };
  network: {
    getSnapshot: () => Promise<NetworkStatusSnapshot>;
    getProxyDiagnostics: () => Promise<ProxyDiagnostics>;
  };
  host: {
    start: (
      roomName: string,
      nickname: string,
      connectionMode: AppSettings["connectionMode"],
    ) => Promise<HostSessionInfo>;
    stop: () => Promise<void>;
    diagnoseJoin: (
      signalingUrl: string,
      connectionMode: AppSettings["connectionMode"],
    ) => Promise<JoinRoomDiagnostic>;
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
}
