export type PreferredSampleRate = "auto" | "32000" | "44100" | "48000";
export type MicMonitorMode = "processed" | "raw";
export type LowCutFrequency = "off" | "90" | "120";
export type ScreenShareQuality = "720p" | "1080p";
export type UiScale = 100 | 110 | 125;
export type BuiltInAvatarId = "fox" | "cat" | "duck" | "panda" | "corgi";
export type MicEqualizerGains = [number, number, number, number, number];

export interface AppSettings {
  settingsSchemaVersion: number;
  profileSchemaVersion: number;
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
  preferredSampleRate: PreferredSampleRate;
  inputLevelThreshold: number;
  micEqualizerGains: MicEqualizerGains;
  lowCutFrequency: LowCutFrequency;
  globalMuteShortcut: string;
  pushToTalkShortcut: string;
  recordingMarkerShortcut: string;
  isNoiseSuppressionEnabled: boolean;
  isEchoCancellationEnabled: boolean;
  isAutoGainControlEnabled: boolean;
  isPushToTalkEnabled: boolean;
  micMonitorMode: MicMonitorMode;
  relayServerUrl?: string;
  memberVolumes: Record<string, number>;
  soundVolume: number;
  screenShareQuality: ScreenShareQuality;
  isScreenShareSystemAudioEnabled: boolean;
  isSystemNotificationEnabled: boolean;
  isMicOnSoundEnabled: boolean;
  isMicOffSoundEnabled: boolean;
  isMemberJoinSoundEnabled: boolean;
  isMemberLeaveSoundEnabled: boolean;
  isConnectionSoundEnabled: boolean;
  isUiSoundEnabled: boolean;
  isBackgroundUpdateCheckEnabled: boolean;
  isAutoDownloadUpdateEnabled?: boolean;
  isAutoInstallUpdateEnabled?: boolean;
  lastUpdateCheckAt?: string;
  lastUpdateVersionSeen?: string;
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
  phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "error";
  message: string;
  percent?: number;
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
