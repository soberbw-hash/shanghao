import { TARGET_CHANNEL_COUNT, TARGET_SAMPLE_RATE } from "@private-voice/shared";

export interface AudioConstraintOverrides {
  deviceId?: string;
  noiseSuppression?: boolean;
  echoCancellation?: boolean;
  autoGainControl?: boolean;
}

export const createAudioConstraints = (
  overrides: AudioConstraintOverrides = {},
): MediaStreamConstraints => ({
  audio: {
    deviceId: overrides.deviceId ? { exact: overrides.deviceId } : undefined,
    echoCancellation: overrides.echoCancellation ?? true,
    noiseSuppression: overrides.noiseSuppression ?? true,
    autoGainControl: overrides.autoGainControl ?? true,
    channelCount: TARGET_CHANNEL_COUNT,
    sampleRate: TARGET_SAMPLE_RATE,
  },
  video: false,
});
