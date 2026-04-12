import { TailscaleState } from "../enums/app.enums";

export type ConnectionMode = "direct_host" | "tailscale" | "relay";
export type PreferredSampleRate = "auto" | "44100" | "48000";
export type MicMonitorMode = "processed" | "raw";

export interface AppSettings {
  settingsSchemaVersion: number;
  nickname: string;
  roomName: string;
  avatarPath?: string;
  hasCompletedProfileSetup: boolean;
  minimizeToTray: boolean;
  reduceMotion: boolean;
  launchOnStartup: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  preferredSampleRate: PreferredSampleRate;
  inputLevelThreshold: number;
  globalMuteShortcut: string;
  pushToTalkShortcut: string;
  isNoiseSuppressionEnabled: boolean;
  isEchoCancellationEnabled: boolean;
  isAutoGainControlEnabled: boolean;
  isPushToTalkEnabled: boolean;
  micMonitorMode: MicMonitorMode;
  connectionMode: ConnectionMode;
  relayServerUrl?: string;
  relayAuthToken?: string;
  manualDirectHost?: string;
  shouldAutoCopyInviteLink: boolean;
  isMicOnSoundEnabled: boolean;
  isMicOffSoundEnabled: boolean;
  isMemberJoinSoundEnabled: boolean;
  isMemberLeaveSoundEnabled: boolean;
  isConnectionSoundEnabled: boolean;
  isBackgroundUpdateCheckEnabled: boolean;
  lastUpdateCheckAt?: string;
  lastUpdateVersionSeen?: string;
}

export interface TailscaleStatus {
  state: TailscaleState;
  isInstalled: boolean;
  isConnected: boolean;
  hostname?: string;
  magicDnsName?: string;
  tailnet?: string;
  ip?: string;
  message: string;
  installUrl?: string;
}

export interface ProxyDiagnostics {
  hasSystemProxy: boolean;
  proxyDescription?: string;
  hasTunAdapter: boolean;
  tunAdapterNames: string[];
  hasClashLikeAdapter: boolean;
  directBypassEnabled: boolean;
  compatibilityModeEnabled?: boolean;
  message: string;
}

export interface RelayStatusSnapshot {
  serverUrl?: string;
  isConfigured: boolean;
  isReachable: boolean;
  lastCheckedAt?: string;
  message: string;
}

export interface DirectHostProbeSummary {
  publicIp?: string;
  manualHost?: string;
  selectedHost?: string;
  selectedPort?: number;
  addressSource:
    | "manual_public_host"
    | "public_ip"
    | "magicdns"
    | "tailscale_ip"
    | "relay"
    | "unknown";
  upnpAttempted: boolean;
  upnpMapped: boolean;
  natPmpAttempted: boolean;
  natPmpMapped: boolean;
  reachability: "reachable" | "unreachable" | "unverified";
  natTendency: "direct_friendly" | "mapping_required" | "restricted" | "unknown";
  message: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  checkedAt: string;
  releaseUrl: string;
  message: string;
}

export interface NetworkStatusSnapshot {
  tailscale?: TailscaleStatus;
  proxy?: ProxyDiagnostics;
  publicIp?: string;
  relay?: RelayStatusSnapshot;
  directHost?: DirectHostProbeSummary;
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
