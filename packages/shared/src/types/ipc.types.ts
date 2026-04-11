import type {
  AppSettings,
  ProfileAvatarSelection,
  TailscaleStatus,
} from "./settings.types";
import type { DiagnosticsSnapshot, LogCategory, LogEntry } from "./diagnostics.types";
import type { HostSessionInfo } from "./room.types";
import type {
  RecordingExportPayload,
  RecordingExportResponse,
} from "./recording.types";

export interface RuntimeInfo {
  appName: string;
  version: string;
  platform: string;
}

export interface RendererLogPayload {
  category: LogCategory;
  level: LogEntry["level"];
  message: string;
  context?: Record<string, unknown>;
}

export interface DesktopApi {
  app: {
    getRuntimeInfo: () => Promise<RuntimeInfo>;
    writeLog: (payload: RendererLogPayload) => Promise<void>;
  };
  window: {
    minimize: () => Promise<void>;
    hide: () => Promise<void>;
    close: () => Promise<void>;
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
  };
  shortcuts: {
    configureMute: (accelerator: string) => Promise<void>;
    onMuteTriggered: (listener: () => void) => () => void;
  };
  tailscale: {
    checkStatus: () => Promise<TailscaleStatus>;
    openInstallGuide: () => Promise<void>;
  };
  host: {
    start: (roomName: string, nickname: string) => Promise<HostSessionInfo>;
    stop: () => Promise<void>;
  };
  recording: {
    export: (
      payload: RecordingExportPayload,
    ) => Promise<RecordingExportResponse>;
  };
}
