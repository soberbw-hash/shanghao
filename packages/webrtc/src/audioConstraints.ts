import { MICROPHONE_PROCESSING_SAMPLE_RATE, TARGET_CHANNEL_COUNT } from "@private-voice/shared";

export interface AudioConstraintOverrides {
  deviceId?: string;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
}

export const createAudioConstraints = (
  overrides: AudioConstraintOverrides = {},
): MediaStreamConstraints => {
  const audioConstraints = {
    deviceId: overrides.deviceId ? { exact: overrides.deviceId } : undefined,
    echoCancellation: { ideal: overrides.echoCancellation ?? true },
    noiseSuppression: { ideal: overrides.noiseSuppression ?? true },
    autoGainControl: { ideal: overrides.autoGainControl ?? true },
    channelCount: { ideal: TARGET_CHANNEL_COUNT },
    sampleRate: { ideal: MICROPHONE_PROCESSING_SAMPLE_RATE },
    sampleSize: { ideal: 16 },
    latency: { ideal: 0.02 },
    googEchoCancellation: overrides.echoCancellation ?? true,
    googNoiseSuppression: overrides.noiseSuppression ?? true,
    googHighpassFilter: true,
    googAutoGainControl: overrides.autoGainControl ?? true,
    googTypingNoiseDetection: true,
  } as MediaTrackConstraints;

  return {
    audio: audioConstraints,
    video: false,
  };
};
