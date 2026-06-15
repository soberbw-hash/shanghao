import { TailscaleState } from "../enums/app.enums";

export type ConnectionMode = "cloudflare_tunnel" | "relay" | "tailscale" | "direct_host";
export type PreferredSampleRate = "auto" | "44100" | "48000";
export type MicMonitorMode = "processed" | "raw";
export type BuiltInAvatarId = "fox" | "cat" | "duck" | "panda" | "corgi";

export interface AppSettings {
  settingsSchemaVersion: number;
  profileSchemaVersion: number;
  nickname: string;
  roomName: string;
  avatarId: BuiltInAvatarId;
  avatarPath?: string;
  hasCompletedProfileSetup: boolean;
  /** @deprecated Legacy field - will be removed in future version */
  channelAccessCode: string;
  minimizeToTray: boolean;
  reduceMotion: boolean;
  /** @deprecated Legacy field - will be removed in future version */
  showFloatingBarOnJoin: boolean;
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
  /** @deprecated Legacy field - only relay mode is used */
  connectionMode: ConnectionMode;
  relayServerUrl?: string;
  /** @deprecated Legacy field - will be removed in future version */
  relayAuthToken?: string;
  /** @deprecated Legacy field - will be removed in future version */
  manualDirectHost?: string;
  /** @deprecated Legacy field - will be removed in future version */
  shouldAutoCopyInviteLink: boolean;
  isMicOnSoundEnabled: boolean;
  isMicOffSoundEnabled: boolean;
  isMemberJoinSoundEnabled: boolean;
  isMemberLeaveSoundEnabled: boolean;
  isConnectionSoundEnabled: boolean;
  isUiSoundEnabled: boolean;
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
  fakeIpAddresses?: string[];
  directBypassEnabled: boolean;
  compatibilityModeEnabled?: boolean;
  message: string;
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
  hasVersionMismatch?: boolean;
  lastCheckedAt?: string;
  message: string;
}

export interface CloudflareTunnelStatus {
  isInstalled: boolean;
  version?: string;
  processState: "idle" | "downloading" | "starting" | "active" | "stopped" | "failed";
  healthState?: "idle" | "healthy" | "degraded" | "failed";
  tunnelUrl?: string;
  tunnelStartedAt?: string;
  processPid?: number;
  lastStdout?: string;
  lastStderr?: string;
  lastHealthCheckAt?: string;
  consecutiveHealthFailures?: number;
  lastExitCode?: number | null;
  lastError?: string;
  message: string;
}

export interface DirectHostProbeSummary {
  publicIp?: string;
  manualHost?: string;
  selectedHost?: string;
  selectedPort?: number;
  addressSource:
    | "manual_public_host"
    | "lan_ipv4"
    | "public_ip"
    | "magicdns"
    | "tailscale_ip"
    | "relay"
    | "unknown";
  upnpAttempted: boolean;
  upnpMapped: boolean;
  natPmpAttempted: boolean;
  natPmpMapped: boolean;
  reachability: "pending" | "reachable" | "unreachable" | "unverified";
  natTendency: "direct_friendly" | "mapping_required" | "restricted" | "unknown";
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
