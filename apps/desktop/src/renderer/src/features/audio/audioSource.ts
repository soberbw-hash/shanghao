import { requestMicrophoneStream, type AudioConstraintOverrides } from "@private-voice/webrtc";
import type { LocalAudioDiagnostics } from "@private-voice/shared";

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
  const result = await requestMicrophoneStream({
    deviceId,
    noiseSuppression: false,
    echoCancellation: processing.echoCancellation,
    autoGainControl: processing.autoGainControl,
  });
  return { ...result, stopInputOnDispose: true };
};
