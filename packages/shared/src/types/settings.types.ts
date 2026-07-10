export type PreferredSampleRate = "auto" | "32000" | "44100" | "48000";
export type MicMonitorMode = "processed" | "raw";
export type ScreenShareQuality = "smooth" | "balanced" | "clear";
export type BuiltInAvatarId = "fox" | "cat" | "duck" | "panda" | "corgi";
export type MicEqualizerGains = [
  number,
  number,
  number,
  number,
  number,
];

export interface AppSettings {
  settingsSchemaVersion: number;
  profileSchemaVersion: number;
  nickname: string;
  roomName: string;
  avatarId: BuiltInAvatarId;
  avatarPath?: string;
  hasCompletedProfileSetup: boolean;
  minimizeToTray: boolean;
  reduceMotion: boolean;
  launchOnStartup: boolean;
  isHardwareAccelerationEnabled: boolean;
  isOverlayEnabled: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  preferredSampleRate: PreferredSampleRate;
  inputLevelThreshold: number;
  micEqualizerGains: MicEqualizerGains;
  isLowCutEnabled: boolean;
  globalMuteShortcut: string;
  pushToTalkShortcut: string;
  recordingMarkerShortcut: string;
  isNoiseSuppressionEnabled: boolean;
  isEchoCancellationEnabled: boolean;
  isAutoGainControlEnabled: boolean;
  isPushToTalkEnabled: boolean;
  micMonitorMode: MicMonitorMode;
  relayServerUrl?: string;
  customStatus: string;
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
