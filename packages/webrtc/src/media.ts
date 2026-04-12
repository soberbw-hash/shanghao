import {
  AudioDeviceState,
  MicPermissionState,
  type AudioDeviceDescriptor,
  type AudioDeviceKind,
  type LocalAudioDiagnostics,
} from "@private-voice/shared";

import { createAudioConstraints, type AudioConstraintOverrides } from "./audioConstraints";

export const requestMicrophoneStream = async (
  overrides: AudioConstraintOverrides = {},
): Promise<{
  stream: MediaStream;
  diagnostics: LocalAudioDiagnostics;
}> => {
  const stream = await navigator.mediaDevices.getUserMedia(createAudioConstraints(overrides));
  const [track] = stream.getAudioTracks();
  const settings = track?.getSettings() ?? {};

  return {
    stream,
    diagnostics: {
      requestedSampleRate:
        overrides.preferredSampleRate && overrides.preferredSampleRate !== "auto"
          ? Number(overrides.preferredSampleRate)
          : 44_100,
      actualSampleRate: settings.sampleRate,
      actualChannelCount: settings.channelCount,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      permissionState: MicPermissionState.Granted,
    },
  };
};

export const readMicrophonePermissionState = async (): Promise<MicPermissionState> => {
  if (!("permissions" in navigator)) {
    return MicPermissionState.Unknown;
  }

  try {
    const result = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });

    switch (result.state) {
      case "granted":
        return MicPermissionState.Granted;
      case "denied":
        return MicPermissionState.Denied;
      case "prompt":
        return MicPermissionState.Prompt;
      default:
        return MicPermissionState.Unknown;
    }
  } catch {
    return MicPermissionState.Unavailable;
  }
};

export const listAudioDevices = async (): Promise<AudioDeviceDescriptor[]> => {
  const devices = await navigator.mediaDevices.enumerateDevices();

  return devices
    .filter(
      (device): device is MediaDeviceInfo =>
        device.kind === "audioinput" || device.kind === "audiooutput",
    )
    .map((device) => ({
      id: device.deviceId,
      label: device.label || (device.kind === "audioinput" ? "未命名麦克风" : "未命名扬声器"),
      kind: device.kind as AudioDeviceKind,
      groupId: device.groupId,
      state: AudioDeviceState.Ready,
      isDefault: device.deviceId === "default",
    }));
};

export const setAudioElementSinkId = async (
  audioElement: HTMLAudioElement,
  outputDeviceId: string,
): Promise<void> => {
  if (!("setSinkId" in audioElement)) {
    return;
  }

  const sinkElement = audioElement as HTMLAudioElement & {
    setSinkId: (sinkId: string) => Promise<void>;
  };

  await sinkElement.setSinkId(outputDeviceId);
};

export const replaceAudioTrack = async (
  peerConnection: RTCPeerConnection,
  nextTrack: MediaStreamTrack,
): Promise<void> => {
  const sender = peerConnection
    .getSenders()
    .find((candidate) => candidate.track?.kind === "audio");

  if (sender) {
    await sender.replaceTrack(nextTrack);
    return;
  }

  peerConnection.addTrack(nextTrack, new MediaStream([nextTrack]));
};
