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
  RendererRuntimeHealthInput,
  RealtimeFaultCommand,
  RuntimeHealthSnapshot,
} from "./diagnostics.types";
import type { RoomMember } from "./room.types";
import type {
  RecordingExportPayload,
  RecordingExportResponse,
  RecordingAutomaticCleanupResult,
  RecordingBatchDeleteResult,
  RecordingCleanupProgress,
  RecordingCleanupScan,
  RecordingLibrarySnapshot,
  RecordingLibraryItem,
  RecordingMarker,
  RecordingSpeakerSegmentFinalizePayload,
  RecordingSpeakerSegmentPayload,
  RecordingSpeakerSegmentResponse,
} from "./recording.types";
import type {
  AiCustomProviderInput,
  AiCustomProviderStatus,
  AiHuggingFaceAccessInput,
  AiHuggingFaceAccessStatus,
  AiAsrModelId,
  AiModelAction,
  AiModelId,
  AiRuntimePressure,
  AiRuntimeStatus,
  AiVoiceMemorySnapshot,
  VoiceMemoryAnswer,
  VoiceMemoryGlobalQuestionRequest,
  VoiceMemoryProcessRequest,
  VoiceMemoryQuestionRequest,
  VoiceMemoryRecord,
  VoiceMemorySearchRequest,
  VoiceMemorySearchResult,
} from "./ai.types";
import type { LocalWeatherRequest, LocalWeatherSnapshot } from "./weather.types";
import type {
  AccountAvatarUpdateRequest,
  AccountLoginRequest,
  AccountPasswordResetRequest,
  AccountProfileUpdateRequest,
  AccountRegisterRequest,
  AccountSnapshot,
} from "./account.types";

export interface RuntimeInfo {
  appName: string;
  version: string;
  platform: string;
  protocolVersion: string;
  buildNumber: string;
  isElevated?: boolean;
  requestedExecutionLevel?: "asInvoker" | "requireAdministrator";
}

export interface DeepLinkInvite {
  channelId: "main" | "side";
  serverUrl?: string;
}

export interface WindowsIntegrationStatus {
  platform: string;
  isPackaged: boolean;
  elevation: {
    isElevated: boolean;
    identity?: string;
    method: "windows-token" | "not-windows" | "unavailable";
  };
  firewall: {
    supported: boolean;
    healthy: boolean;
    ruleCount: number;
    expectedRuleCount: number;
    executablePath?: string;
    message: string;
  };
  iconOverlays: {
    supported: boolean;
    hidden: boolean;
    arrowHidden: boolean;
    shieldHidden: boolean;
    message: string;
  };
}

export interface RendererLogPayload {
  category: LogCategory;
  level: LogEntry["level"];
  message: string;
  context?: Record<string, unknown>;
}

export interface DeepFilterAssets {
  wasm: ArrayBuffer;
  model: ArrayBuffer;
}

export interface SignalingEventPayload {
  sessionId: string;
  generation?: number;
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
  isRecording?: boolean;
  isScreenSharing?: boolean;
  hasSystemAudio?: boolean;
}

export interface ScreenCaptureSourceDescriptor {
  id: string;
  name: string;
  kind: "screen" | "window";
  displayId?: string;
  displayLabel?: string;
  thumbnailDataUrl: string;
  appIconDataUrl?: string;
}

export interface ScreenShareViewerOpenRequest {
  title: string;
  sessionId: string;
}

export interface ScreenShareViewerSignal {
  sessionId: string;
  sender: "host" | "viewer";
  type: "ready" | "offer" | "answer" | "ice" | "fallback-frame" | "closed";
  title?: string;
  sdp?: string;
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  frameDataUrl?: string;
}

export interface ScreenShareViewerApi {
  sendSignal: (signal: ScreenShareViewerSignal) => Promise<boolean>;
  close: () => Promise<void>;
  onSignal: (listener: (signal: ScreenShareViewerSignal) => void) => () => void;
}

export interface GameDetectionSnapshot {
  gameName?:
    | "我的世界"
    | "王国保卫战"
    | "杀戮尖塔"
    | "星露谷物语"
    | "英雄联盟"
    | "无畏契约"
    | "三角洲行动"
    | "KK 对战平台"
    | "穿越火线"
    | "地下城与勇士"
    | "魔兽世界"
    | "炉石传说"
    | "燕云十六声"
    | "鸣潮"
    | "绝区零"
    | "暗区突围：无限"
    | "逃离塔科夫"
    | "极限竞速：地平线 5"
    | "赛博朋克 2077"
    | "巫师 3"
    | "战地风云"
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
    | "失控进化"
    | "逆战：未来"
    | "王者荣耀世界"
    | "异人之下"
    | "命运方舟"
    | "塔瑞斯世界"
    | "剑灵 2"
    | "终极角逐"
    | "洛克王国：世界"
    | "粒粒的小人国"
    | "黑神话：悟空"
    | "失落城堡 2"
    | "艾尔登法环"
    | "双人成行"
    | "幻兽帕鲁"
    | "胡闹厨房"
    | "荒野大镖客 2";
  gameIconDataUrl?: string;
  detectedAt?: string;
  musicActivity?: import("./room.types").MusicActivity;
  workActivity?: import("./room.types").WorkActivity;
  checkedAt: string;
}

export interface DesktopApi {
  app: {
    getRuntimeInfo: () => Promise<RuntimeInfo>;
    getSystemIdleSeconds: () => Promise<number>;
    writeLog: (payload: RendererLogPayload) => Promise<void>;
    notify: (payload: {
      title: string;
      body: string;
      attention?: boolean;
      shakeWindow?: boolean;
      showNotification?: boolean;
    }) => Promise<void>;
    onLifecycleRecovery: (listener: (notice: { reason: string; at: string }) => void) => () => void;
    readChatHistory: (payload: {
      serverUrl: string;
      channelId: string;
    }) => Promise<import("./room.types").ChatMessage[]>;
    saveChatHistory: (payload: {
      serverUrl: string;
      channelId: string;
      messages: import("./room.types").ChatMessage[];
    }) => Promise<void>;
    readDailyRoomReports: () => Promise<
      Record<"main" | "side", import("./room.types").DailyRoomReport[]>
    >;
    saveDailyRoomReports: (
      reports: Record<"main" | "side", import("./room.types").DailyRoomReport[]>,
    ) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    openSystemSettings: (page: "microphone" | "sound" | "display") => Promise<void>;
    getLinkPreviewIcon: (url: string) => Promise<string | undefined>;
    consumeDeepLink: () => Promise<DeepLinkInvite | undefined>;
    onDeepLink: (listener: (invite: DeepLinkInvite) => void) => () => void;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
    writeImage: (dataUrl: string) => Promise<void>;
  };
  audio: {
    getDeepFilterAssets: () => Promise<DeepFilterAssets>;
  };
  quickMessages: {
    export: () => Promise<string | undefined>;
  };
  screenCapture: {
    listSources: () => Promise<ScreenCaptureSourceDescriptor[]>;
    selectSource: (sourceId: string) => Promise<void>;
    setContentProtection: (enabled: boolean) => Promise<void>;
  };
  screenShareViewer: ScreenShareViewerApi & {
    open: (request: ScreenShareViewerOpenRequest) => Promise<void>;
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
    setInteractive: (interactive: boolean) => Promise<void>;
    moveTo: (screenY: number) => Promise<void>;
    resetPosition: () => Promise<void>;
    onState: (listener: (state: OverlayState) => void) => () => void;
    onHoverState: (listener: (inside: boolean) => void) => () => void;
  };
  games: {
    getSnapshot: () => Promise<GameDetectionSnapshot>;
    onDetected: (listener: (snapshot: GameDetectionSnapshot) => void) => () => void;
  };
  weather: {
    getSnapshot: (request: LocalWeatherRequest) => Promise<LocalWeatherSnapshot>;
  };
  ai: {
    getSnapshot: () => Promise<AiVoiceMemorySnapshot>;
    controlModel: (modelId: AiModelId, action: AiModelAction) => Promise<AiVoiceMemorySnapshot>;
    getRuntimeStatus: () => Promise<AiRuntimeStatus>;
    getVoiceMemory: (recordingId: string) => Promise<VoiceMemoryRecord | undefined>;
    listVoiceMemories: () => Promise<VoiceMemoryRecord[]>;
    processRecording: (request: VoiceMemoryProcessRequest) => Promise<VoiceMemoryRecord>;
    selectTranscription: (recordingId: string, modelId: AiAsrModelId) => Promise<VoiceMemoryRecord>;
    pauseTask: (recordingId: string) => Promise<void>;
    resumeTask: (recordingId: string) => Promise<VoiceMemoryRecord>;
    assignSpeaker: (
      recordingId: string,
      speakerId: string,
      memberId: string,
      nickname: string,
    ) => Promise<VoiceMemoryRecord>;
    updateMarkerTitle: (
      recordingId: string,
      markerId: string,
      title: string,
    ) => Promise<VoiceMemoryRecord>;
    askRecording: (request: VoiceMemoryQuestionRequest) => Promise<VoiceMemoryAnswer>;
    askMemory: (request: VoiceMemoryGlobalQuestionRequest) => Promise<VoiceMemoryAnswer>;
    cancelQuestion: () => Promise<boolean>;
    searchMemory: (request: VoiceMemorySearchRequest) => Promise<VoiceMemorySearchResult[]>;
    getCustomProvider: () => Promise<AiCustomProviderStatus>;
    saveCustomProvider: (input: AiCustomProviderInput) => Promise<AiCustomProviderStatus>;
    clearCustomProvider: () => Promise<void>;
    getHuggingFaceAccess: () => Promise<AiHuggingFaceAccessStatus>;
    saveHuggingFaceAccess: (input: AiHuggingFaceAccessInput) => Promise<AiHuggingFaceAccessStatus>;
    clearHuggingFaceAccess: () => Promise<void>;
    updateRuntimePressure: (pressure: AiRuntimePressure) => Promise<void>;
    onStatus: (listener: (snapshot: AiVoiceMemorySnapshot) => void) => () => void;
    onVoiceMemoryStatus: (listener: (record: VoiceMemoryRecord) => void) => () => void;
  };
  settings: {
    get: () => Promise<AppSettings>;
    save: (settings: Partial<AppSettings>) => Promise<AppSettings>;
    reset: () => Promise<AppSettings>;
  };
  account: {
    getSnapshot: () => Promise<AccountSnapshot>;
    login: (request: AccountLoginRequest) => Promise<AccountSnapshot>;
    register: (request: AccountRegisterRequest) => Promise<AccountSnapshot>;
    requestPasswordReset: (request: AccountPasswordResetRequest) => Promise<void>;
    updateProfile: (request: AccountProfileUpdateRequest) => Promise<AccountSnapshot>;
    updateAvatar: (request: AccountAvatarUpdateRequest) => Promise<AccountSnapshot>;
    logout: () => Promise<AccountSnapshot>;
    continueAsGuest: () => Promise<AccountSnapshot>;
    onChanged: (listener: (snapshot: AccountSnapshot) => void) => () => void;
  };
  profile: {
    pickAvatar: () => Promise<ProfileAvatarSelection | undefined>;
    readAvatar: (avatarPath?: string) => Promise<string | undefined>;
    clearAvatar: (avatarPath?: string) => Promise<void>;
  };
  diagnostics: {
    snapshot: () => Promise<DiagnosticsSnapshot>;
    runtimeHealth: (renderer?: RendererRuntimeHealthInput) => Promise<RuntimeHealthSnapshot>;
    testServer: (serverUrl: string) => Promise<import("./settings.types").RelayStatusSnapshot>;
    exportLogs: () => Promise<DiagnosticsSnapshot>;
    exportBundle: (rendererState?: RendererDiagnosticsSummary) => Promise<DiagnosticsSnapshot>;
    openLogsDirectory: () => Promise<void>;
  };
  windows: {
    getStatus: () => Promise<WindowsIntegrationStatus>;
    repairFirewall: () => Promise<WindowsIntegrationStatus["firewall"]>;
    removeFirewall: () => Promise<WindowsIntegrationStatus["firewall"]>;
    setIconOverlaysHidden: (hidden: boolean) => Promise<WindowsIntegrationStatus["iconOverlays"]>;
  };
  shortcuts: {
    configureMute: (accelerator: string) => Promise<void>;
    onMuteTriggered: (listener: () => void) => () => void;
    configureRecordingMarker: (accelerator: string) => Promise<boolean>;
    onRecordingMarkerTriggered: (listener: () => void) => () => void;
    configureQuickMessage: (slot: number, accelerator: string) => Promise<boolean>;
    onQuickMessageTriggered: (listener: (slot: number) => void) => () => void;
  };
  updates: {
    check: () => Promise<UpdateCheckResult>;
    download: () => Promise<void>;
    install: () => Promise<void>;
    onStatus: (listener: (status: UpdateStatus) => void) => () => void;
    openReleases: () => Promise<void>;
  };
  signaling: {
    connect: (signalingUrl: string, sessionId: string) => Promise<void>;
    send: (payload: string, sessionId: string) => Promise<void>;
    close: (sessionId: string) => Promise<void>;
    injectFault: (sessionId: string, command: RealtimeFaultCommand) => Promise<void>;
    onEvent: (listener: (payload: SignalingEventPayload) => void) => () => void;
  };
  recording: {
    export: (payload: RecordingExportPayload) => Promise<RecordingExportResponse>;
    saveSpeakerSegment: (
      payload: RecordingSpeakerSegmentPayload,
    ) => Promise<RecordingSpeakerSegmentResponse>;
    finalizeSpeakerSegments: (payload: RecordingSpeakerSegmentFinalizePayload) => Promise<void>;
    chooseDirectory: () => Promise<string | undefined>;
    saveMarkers: (filePath: string, markers: RecordingMarker[]) => Promise<string>;
    applyAutomaticCleanup: (filePath: string) => Promise<RecordingAutomaticCleanupResult>;
    list: () => Promise<RecordingLibrarySnapshot>;
    scanWaste: () => Promise<RecordingCleanupScan>;
    onScanWasteProgress: (listener: (progress: RecordingCleanupProgress) => void) => () => void;
    setFavorite: (filePath: string, isFavorite: boolean) => Promise<void>;
    rename: (recordingId: string, title: string) => Promise<RecordingLibraryItem>;
    openDirectory: () => Promise<void>;
    delete: (filePath: string) => Promise<void>;
    deleteMany: (filePaths: string[]) => Promise<RecordingBatchDeleteResult>;
  };
}
