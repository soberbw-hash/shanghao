import { requestMicrophoneStream, type AudioConstraintOverrides } from "@private-voice/webrtc";
import {
  MICROPHONE_PROCESSING_SAMPLE_RATE,
  MicPermissionState,
  type LocalAudioDiagnostics,
} from "@private-voice/shared";

import { PHONE_MIC_DEVICE_ID, phoneMicSource } from "./phoneMicSource";

export interface AcquiredAudioSource {
  stream: MediaStream;
  diagnostics: LocalAudioDiagnostics;
  /** The phone transport, not a DSP graph, owns its remote track. */
  stopInputOnDispose: boolean;
}

export const releaseAcquiredAudioSource = (
  source: Pick<AcquiredAudioSource, "stream" | "stopInputOnDispose">,
): void => {
  if (!source.stopInputOnDispose) return;
  source.stream.getTracks().forEach((track) => track.stop());
};

export const acquireAudioSource = async (
  deviceId: string | undefined,
  processing: Pick<AudioConstraintOverrides, "echoCancellation" | "autoGainControl">,
  existingInput?: MediaStream,
): Promise<AcquiredAudioSource> => {
  if (deviceId === PHONE_MIC_DEVICE_ID) {
    const stream = phoneMicSource.getStream();
    if (!stream?.getAudioTracks().some((track) => track.readyState === "live")) {
      throw new Error("手机麦克风尚未开始传输，请扫码并点击开始传输。");
    }
    return {
      stream,
      diagnostics: phoneMicSource.getDiagnostics(),
      stopInputOnDispose: false,
    };
  }
  // The caller only supplies capture belonging to the same selected device.
  // A cloned track keeps capture alive while the old DSP graph is disposed.
  // Browser-level AEC/AGC changes still require a fresh capture.
  const existingTrack = existingInput?.getAudioTracks()[0];
  const existingSettings = existingTrack?.getSettings();
  if (
    existingTrack?.readyState === "live" &&
    !existingTrack.muted &&
    existingSettings &&
    existingSettings.echoCancellation === processing.echoCancellation &&
    existingSettings.autoGainControl === processing.autoGainControl
  ) {
    const stream = new MediaStream([existingTrack.clone()]);
    return {
      stream,
      stopInputOnDispose: true,
      diagnostics: {
        requestedSampleRate: MICROPHONE_PROCESSING_SAMPLE_RATE,
        permissionState: MicPermissionState.Granted,
        actualSampleRate: existingSettings.sampleRate,
        actualChannelCount: existingSettings.channelCount,
        echoCancellation: existingSettings.echoCancellation,
        autoGainControl: existingSettings.autoGainControl,
        noiseSuppression: existingSettings.noiseSuppression,
      },
    };
  }
  const result = await requestMicrophoneStream({
    deviceId,
    noiseSuppression: false,
    echoCancellation: processing.echoCancellation,
    autoGainControl: processing.autoGainControl,
  });
  return { ...result, stopInputOnDispose: true };
};
