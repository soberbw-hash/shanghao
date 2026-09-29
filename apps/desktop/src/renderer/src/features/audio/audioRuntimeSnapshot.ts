import type { AppSettings, LocalAudioDiagnostics } from "@private-voice/shared";

import { PHONE_MIC_DEVICE_ID } from "./phoneMicSource";

export interface AudioRuntimeSnapshot {
  desired: {
    noiseSuppression: boolean;
    voiceEnhancement: boolean;
    echoCancellation: boolean;
    autoGainControl: boolean;
    inputSource: "phone" | "device";
    outputDevice: "default" | "selected";
  };
  applied: {
    noiseProcessor?: LocalAudioDiagnostics["noiseProcessor"];
    voiceEnhancementProcessor?: LocalAudioDiagnostics["voiceEnhancementProcessor"];
    inputSource?: "phone" | "device";
    outputDevice?: "default" | "selected";
  };
  observed: {
    processorPresent: boolean;
    outputTrackState: "live" | "ended" | "missing";
    outputRouteStatus:
      "not_started" | "applying" | "applied" | "fallback" | "unsupported" | "failed";
  };
  health: "idle" | "starting" | "healthy" | "degraded" | "failed";
}

/** A privacy-safe view of settings, the applied DSP graph and the live output. */
export const createAudioRuntimeSnapshot = ({
  settings,
  appliedSourceId,
  processorPresent,
  processorDiagnostics,
  outputTrack,
  roomClientPresent,
  appliedOutputDeviceId,
  outputRouteStatus = "not_started",
}: {
  settings?: Pick<
    AppSettings,
    | "isNoiseSuppressionEnabled"
    | "isVoiceEnhancementEnabled"
    | "isEchoCancellationEnabled"
    | "isAutoGainControlEnabled"
    | "preferredInputDeviceId"
    | "preferredOutputDeviceId"
  >;
  appliedSourceId?: string;
  processorPresent: boolean;
  processorDiagnostics?: Pick<
    LocalAudioDiagnostics,
    "noiseProcessor" | "voiceEnhancementProcessor"
  >;
  outputTrack?: MediaStreamTrack;
  roomClientPresent: boolean;
  appliedOutputDeviceId?: string;
  outputRouteStatus?: AudioRuntimeSnapshot["observed"]["outputRouteStatus"];
}): AudioRuntimeSnapshot => {
  const desiredInputSource: "phone" | "device" =
    settings?.preferredInputDeviceId === PHONE_MIC_DEVICE_ID ? "phone" : "device";
  const desired: AudioRuntimeSnapshot["desired"] = {
    noiseSuppression: settings?.isNoiseSuppressionEnabled ?? true,
    voiceEnhancement: settings?.isVoiceEnhancementEnabled ?? true,
    echoCancellation: settings?.isEchoCancellationEnabled ?? true,
    autoGainControl: settings?.isAutoGainControlEnabled ?? true,
    inputSource: desiredInputSource,
    outputDevice: settings?.preferredOutputDeviceId ? "selected" : "default",
  };
  const outputTrackState = outputTrack?.readyState ?? "missing";
  const noiseProcessor = processorPresent ? processorDiagnostics?.noiseProcessor : undefined;
  const voiceEnhancementProcessor = processorPresent
    ? processorDiagnostics?.voiceEnhancementProcessor
    : undefined;
  const health =
    !roomClientPresent && !processorPresent
      ? "idle"
      : roomClientPresent && outputTrackState !== "live"
        ? "failed"
        : !processorPresent || outputTrackState !== "live"
          ? "starting"
          : (desired.noiseSuppression && noiseProcessor === "deepfilter_unavailable") ||
              (desired.voiceEnhancement && voiceEnhancementProcessor === "dsp_unavailable") ||
              ["fallback", "unsupported", "failed"].includes(outputRouteStatus)
            ? "degraded"
            : "healthy";
  return {
    desired,
    applied: {
      noiseProcessor,
      voiceEnhancementProcessor,
      inputSource: processorPresent
        ? appliedSourceId === PHONE_MIC_DEVICE_ID
          ? "phone"
          : "device"
        : undefined,
      outputDevice: appliedOutputDeviceId
        ? appliedOutputDeviceId === "default"
          ? "default"
          : "selected"
        : undefined,
    },
    observed: { processorPresent, outputTrackState, outputRouteStatus },
    health,
  };
};
