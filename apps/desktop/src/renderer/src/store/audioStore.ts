import {
  AudioDeviceState,
  MicPermissionState,
  PushToTalkState,
  type AudioDeviceDescriptor,
  type LocalAudioDiagnostics,
} from "@private-voice/shared";
import { create } from "zustand";

import { listAudioDevices, readMicrophonePermissionState } from "@private-voice/webrtc";

import { writeRendererLog } from "../utils/logger";

interface AudioStoreState {
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  permissionState: MicPermissionState;
  inputState: AudioDeviceState;
  outputState: AudioDeviceState;
  localDiagnostics?: LocalAudioDiagnostics;
  isMuted: boolean;
  isNoiseSuppressionEnabled: boolean;
  isPushToTalkEnabled: boolean;
  pushToTalkState: PushToTalkState;
  refreshDevices: () => Promise<void>;
  toggleMute: () => void;
  setMuted: (isMuted: boolean) => void;
  setNoiseSuppressionEnabled: (isEnabled: boolean) => void;
  setPushToTalkEnabled: (isEnabled: boolean) => void;
  setPushToTalkState: (state: PushToTalkState) => void;
  setLocalDiagnostics: (diagnostics: LocalAudioDiagnostics) => void;
}

export const useAudioStore = create<AudioStoreState>((set) => ({
  inputDevices: [],
  outputDevices: [],
  permissionState: MicPermissionState.Unknown,
  inputState: AudioDeviceState.Ready,
  outputState: AudioDeviceState.Ready,
  localDiagnostics: undefined,
  isMuted: false,
  isNoiseSuppressionEnabled: true,
  isPushToTalkEnabled: false,
  pushToTalkState: PushToTalkState.Off,
  refreshDevices: async () => {
    try {
      const [devices, permissionState] = await Promise.all([
        listAudioDevices(),
        readMicrophonePermissionState(),
      ]);

      const inputDevices = devices.filter((device) => device.kind === "audioinput");
      const outputDevices = devices.filter((device) => device.kind === "audiooutput");

      set({
        inputDevices,
        outputDevices,
        permissionState,
        inputState: inputDevices.length > 0 ? AudioDeviceState.Ready : AudioDeviceState.Missing,
        outputState:
          outputDevices.length > 0 ? AudioDeviceState.Ready : AudioDeviceState.Missing,
      });

      await writeRendererLog("devices", "info", "Enumerated audio devices", {
        inputCount: inputDevices.length,
        outputCount: outputDevices.length,
        permissionState,
      });
    } catch (error) {
      set({
        inputDevices: [],
        outputDevices: [],
        permissionState: MicPermissionState.Unavailable,
        inputState: AudioDeviceState.Failed,
        outputState: AudioDeviceState.Failed,
      });

      await writeRendererLog("devices", "error", "Failed to enumerate audio devices", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  setMuted: (isMuted) => set({ isMuted }),
  setNoiseSuppressionEnabled: (isNoiseSuppressionEnabled) =>
    set({ isNoiseSuppressionEnabled }),
  setPushToTalkEnabled: (isPushToTalkEnabled) => set({ isPushToTalkEnabled }),
  setPushToTalkState: (pushToTalkState) => set({ pushToTalkState }),
  setLocalDiagnostics: (localDiagnostics) => set({ localDiagnostics }),
}));
