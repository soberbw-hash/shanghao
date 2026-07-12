import { AudioDeviceState, MicPermissionState, PushToTalkState } from "../enums/app.enums";

export type AudioDeviceKind = "audioinput" | "audiooutput";

export interface AudioDeviceDescriptor {
  id: string;
  label: string;
  kind: AudioDeviceKind;
  groupId?: string;
  state: AudioDeviceState;
  isDefault?: boolean;
}

export interface AudioPreferences {
  inputDeviceId?: string;
  outputDeviceId?: string;
  isNoiseSuppressionEnabled: boolean;
  isEchoCancellationEnabled: boolean;
  isAutoGainControlEnabled: boolean;
  isMuted: boolean;
  isPushToTalkEnabled: boolean;
  pushToTalkShortcut: string;
  globalMuteShortcut: string;
  pushToTalkState: PushToTalkState;
}

export interface LocalAudioDiagnostics {
  requestedSampleRate: number;
  actualSampleRate?: number;
  sampleRateFallbackApplied?: boolean;
  actualChannelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  noiseProcessor?: "rnnoise_active" | "browser_fallback" | "bypass";
  processorOverruns?: number;
  averageProcessingMs?: number;
  maxProcessingMs?: number;
  permissionState: MicPermissionState;
}
