import { TailscaleState } from "../enums/app.enums";

export type ConnectionMode = "direct_host" | "tailscale" | "relay";

export interface AppSettings {
  nickname: string;
  roomName: string;
  avatarPath?: string;
  hasCompletedProfileSetup: boolean;
  minimizeToTray: boolean;
  reduceMotion: boolean;
  launchOnStartup: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  globalMuteShortcut: string;
  pushToTalkShortcut: string;
  isNoiseSuppressionEnabled: boolean;
  isPushToTalkEnabled: boolean;
  connectionMode: ConnectionMode;
  relayServerUrl?: string;
  manualDirectHost?: string;
  shouldAutoCopyInviteLink: boolean;
  isMicOnSoundEnabled: boolean;
  isMicOffSoundEnabled: boolean;
  isMemberJoinSoundEnabled: boolean;
  isMemberLeaveSoundEnabled: boolean;
  isConnectionSoundEnabled: boolean;
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
  message: string;
}

export interface NetworkStatusSnapshot {
  tailscale?: TailscaleStatus;
  proxy?: ProxyDiagnostics;
  publicIp?: string;
  relayServerReachable?: boolean;
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
