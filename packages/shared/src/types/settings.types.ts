import { TailscaleState } from "../enums/app.enums";

export interface AppSettings {
  nickname: string;
  roomName: string;
  minimizeToTray: boolean;
  reduceMotion: boolean;
  launchOnStartup: boolean;
  preferredInputDeviceId?: string;
  preferredOutputDeviceId?: string;
  globalMuteShortcut: string;
  pushToTalkShortcut: string;
  isNoiseSuppressionEnabled: boolean;
  isPushToTalkEnabled: boolean;
}

export interface TailscaleStatus {
  state: TailscaleState;
  isInstalled: boolean;
  isConnected: boolean;
  hostname?: string;
  tailnet?: string;
  ip?: string;
  message: string;
  installUrl?: string;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
}
