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
  RecordingMarker,
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

export interface OverlayState {
  members: RoomMember[];
  isMuted: boolean;
  isDeafened: boolean;
  connectionState: string;
}

export interface ScreenCaptureSourceDescriptor {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnailDataUrl: string;
  appIconDataUrl?: string;
}

export interface ScreenShareViewerFrame {
  title: string;
  dataUrl: string;
}

export interface GameDetectionSnapshot {
  gameName?:
    | "我的世界"
    | "王国保卫战"
    | "杀戮尖塔"
    | "英雄联盟"
    | "无畏契约"
    | "三角洲行动"
    | "CS2"
    | "Dota 2"
    | "Apex 英雄"
    | "绝地求生"
    | "守望先锋"
    | "永劫无间"
    | "原神"
    | "崩坏：星穹铁道"
    | "Fortnite"
    | "GTA V"
    | "彩虹六号：围攻"
    | "怪物猎人"
    | "黑神话：悟空"
    | "失落城堡 2"
    | "艾尔登法环"
    | "双人成行"
    | "幻兽帕鲁"
    | "胡闹厨房"
    | "荒野大镖客 2";
  detectedAt?: string;
  checkedAt: string;
}

export interface DesktopApi {
  app: {
    getRuntimeInfo: () => Promise<RuntimeInfo>;
    getSystemIdleSeconds: () => Promise<number>;
    writeLog: (payload: RendererLogPayload) => Promise<void>;
    notify: (payload: { title: string; body: string }) => Promise<void>;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };
  screenCapture: {
    listSources: () => Promise<ScreenCaptureSourceDescriptor[]>;
    selectSource: (sourceId: string) => Promise<void>;
  };
  screenShareViewer: {
    open: (title: string) => Promise<void>;
    updateFrame: (frame: ScreenShareViewerFrame) => Promise<boolean>;
    close: () => Promise<void>;
    onFrame: (listener: (frame: ScreenShareViewerFrame) => void) => () => void;
  };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    hide: () => Promise<void>;
    close: () => Promise<void>;
    show: () => Promise<void>;
  };
  overlay: {
    show: () => Promise<boolean>;
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
    testServer: (serverUrl: string) => Promise<import("./settings.types").RelayStatusSnapshot>;
    exportLogs: () => Promise<DiagnosticsSnapshot>;
    exportBundle: (rendererState?: RendererDiagnosticsSummary) => Promise<DiagnosticsSnapshot>;
    openLogsDirectory: () => Promise<void>;
  };
  shortcuts: {
    configureMute: (accelerator: string) => Promise<void>;
    onMuteTriggered: (listener: () => void) => () => void;
    configureRecordingMarker: (accelerator: string) => Promise<boolean>;
    onRecordingMarkerTriggered: (listener: () => void) => () => void;
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
    export: (payload: RecordingExportPayload) => Promise<RecordingExportResponse>;
    saveMarkers: (filePath: string, markers: RecordingMarker[]) => Promise<string>;
  };
}
