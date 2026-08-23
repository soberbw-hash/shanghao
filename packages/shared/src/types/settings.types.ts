import type { AiAsrModelId, AiProcessingMode, AiTextProvider } from "./ai.types";
import type { WeatherEffectMode, WeatherLocationMode } from "./weather.types";

export type MicMonitorMode = "processed" | "raw";
// Keep legacy values readable during migration; current builds always normalize to 75 Hz.
export type LowCutFrequency = "75" | "off" | "90" | "120";
export type UiScale = 100 | 110 | 125;
export type BuiltInAvatarId = "fox" | "cat" | "duck" | "panda" | "corgi";
export type MicEqualizerGains = [number, number, number, number, number];

export interface AppSettings {
  settingsSchemaVersion: number;
  profileSchemaVersion: number;
  profileId: string;
  nickname: string;
  roomName: string;
  avatarId: BuiltInAvatarId;
  avatarPath?: string;
  hasCompletedProfileSetup: boolean;
  minimizeToTray: boolean;
  uiScale: UiScale;
  launchOnStartup: boolean;
  isHardwareAccelerationEnabled: boolean;
  isOverlayEnabled: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  microphoneSendVolume: number;
  speakerMasterVolume: number;
  isFriendLoudnessBalanceEnabled: boolean;
  micEqualizerGains: MicEqualizerGains;
  lowCutFrequency: LowCutFrequency;
  globalMuteShortcut: string;
  pushToTalkShortcut: string;
  recordingMarkerShortcut: string;
  recordingSaveDirectory?: string;
  recordingLibraryQuotaGb: number;
  isRecordingWasteAutoCleanupEnabled: boolean;
  aiAsrModel: AiAsrModelId;
  aiOrganizerProvider: AiTextProvider;
  aiRoomAskProvider: AiTextProvider;
  aiProcessingMode: AiProcessingMode;
  isAiAutoTranscribeEnabled: boolean;
  isAiAutoOrganizeEnabled: boolean;
  isNoiseSuppressionEnabled: boolean;
  isEchoCancellationEnabled: boolean;
  isAutoGainControlEnabled: boolean;
  isVoiceEnhancementEnabled: boolean;
  isPushToTalkEnabled: boolean;
  isAutoRecordOnJoinEnabled: boolean;
  micMonitorMode: MicMonitorMode;
  relayServerUrl?: string;
  isDeveloperModeEnabled: boolean;
  memberVolumes: Record<string, number>;
  soundVolume: number;
  isSystemNotificationEnabled: boolean;
  isGameDetectionEnabled: boolean;
  isWorkActivityVisible: boolean;
  isDynamicWeatherEnabled: boolean;
  weatherLocationMode: WeatherLocationMode;
  weatherManualCity: string;
  weatherEffectMode: WeatherEffectMode;
  isUiSoundEnabled: boolean;
  isBackgroundUpdateCheckEnabled: boolean;
  lastCollectionViewedAt?: string;
  hasInitializedCollectionReadState: boolean;
  isAutoDownloadUpdateEnabled?: boolean;
  isAutoInstallUpdateEnabled?: boolean;
  lastUpdateCheckAt?: string;
  lastUpdateVersionSeen?: string;
  lastReleaseNotesVersionSeen?: string;
  lastDailyRoomReportSeen?: Partial<Record<"main" | "side", string>>;
}

export interface RelayStatusSnapshot {
  serverUrl?: string;
  isConfigured: boolean;
  isReachable: boolean;
  isHealthReachable?: boolean;
  isWebSocketReachable?: boolean;
  protocolVersion?: string;
  buildNumber?: string;
  packageVersion?: string;
  uptime?: number;
  activeRooms?: number;
  connectedPeers?: number;
  latencyMs?: number;
  turnConfigured?: boolean;
  droppedRealtimeMessages?: number;
  occupiedAvatarIds?: BuiltInAvatarId[];
  hasVersionMismatch?: boolean;
  lastCheckedAt?: string;
  message: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  forceUpdate?: boolean;
  minSupportedVersion?: string;
  releaseNotes?: string;
  canAutoInstall?: boolean;
  checkedAt: string;
  releaseUrl: string;
  message: string;
}

export interface UpdateStatus {
  phase:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "downloaded"
    | "ready_to_restart"
    | "installing"
    | "error";
  message: string;
  percent?: number;
  bytesPerSecond?: number;
  latestVersion?: string;
  forceUpdate?: boolean;
}

export interface NetworkStatusSnapshot {
  relay?: RelayStatusSnapshot;
  update?: UpdateCheckResult;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
}

export interface ProfileAvatarSelection {
  avatarPath: string;
  avatarDataUrl: string;
}
