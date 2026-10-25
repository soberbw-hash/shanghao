import {
  AudioDeviceState,
  MicPermissionState,
  PushToTalkState,
  type AudioDeviceDescriptor,
  type LocalAudioDiagnostics,
} from "@private-voice/shared";
import { create } from "zustand";

import { listAudioDevices, readMicrophonePermissionState } from "@private-voice/webrtc";

import { createDeviceRefreshVersion } from "../features/audio/deviceRecovery";
import { writeRendererLog } from "../utils/logger";

interface AudioStoreState {
  inputDevices: AudioDeviceDescriptor[];
  outputDevices: AudioDeviceDescriptor[];
  permissionState: MicPermissionState;
  inputState: AudioDeviceState;
  outputState: AudioDeviceState;
  localDiagnostics?: LocalAudioDiagnostics;
  isMuted: boolean;
  isManuallyMuted: boolean;
  phoneModeActive: boolean;
  setPhoneMode: (active: boolean) => void;
  isDeafened: boolean;
  isNoiseSuppressionEnabled: boolean;
  isPushToTalkEnabled: boolean;
  pushToTalkState: PushToTalkState;
  refreshDevices: () => Promise<void>;
  toggleMicrophone: () => void;
  toggleDeafen: () => void;
  deafenAndMute: () => void;
  undeafenAndUnmute: () => void;
  setAudioState: (state: { isMuted: boolean; isDeafened: boolean }) => void;
  setMuted: (isMuted: boolean) => void;
  setDeafened: (isDeafened: boolean) => void;
  setNoiseSuppressionEnabled: (isEnabled: boolean) => void;
  setPushToTalkEnabled: (isEnabled: boolean) => void;
  setPushToTalkState: (state: PushToTalkState) => void;
  setLocalDiagnostics: (diagnostics: LocalAudioDiagnostics) => void;
}

let beforePhone: { isMuted: boolean; isDeafened: boolean; isManuallyMuted: boolean } | undefined;
const deviceRefreshVersion = createDeviceRefreshVersion();
export const useAudioStore = create<AudioStoreState>((set) => ({
  phoneModeActive: false,
  setPhoneMode: (active) =>
    set((state) => {
      if (active === state.phoneModeActive) return state;
      if (active) {
        beforePhone = {
          isMuted: state.isMuted,
          isDeafened: state.isDeafened,
          isManuallyMuted: state.isManuallyMuted,
        };
        return { phoneModeActive: true, isMuted: true, isDeafened: true, isManuallyMuted: false };
      }
      const restored = beforePhone ?? { isMuted: true, isDeafened: true, isManuallyMuted: false };
      beforePhone = undefined;
      return { phoneModeActive: false, ...restored };
    }),
  inputDevices: [],
  outputDevices: [],
  permissionState: MicPermissionState.Unknown,
  inputState: AudioDeviceState.Ready,
  outputState: AudioDeviceState.Ready,
  localDiagnostics: undefined,
  isMuted: false,
  isManuallyMuted: false,
  isDeafened: false,
  isNoiseSuppressionEnabled: true,
  isPushToTalkEnabled: false,
  pushToTalkState: PushToTalkState.Off,
  refreshDevices: async () => {
    const version = deviceRefreshVersion.begin();
    try {
      const [devices, permissionState] = await Promise.all([
        listAudioDevices(),
        readMicrophonePermissionState(),
      ]);

      const inputDevices = devices.filter((device) => device.kind === "audioinput");
      const outputDevices = devices.filter((device) => device.kind === "audiooutput");
      if (!deviceRefreshVersion.isLatest(version)) return;

      set({
        inputDevices,
        outputDevices,
        permissionState,
        inputState: inputDevices.length > 0 ? AudioDeviceState.Ready : AudioDeviceState.Missing,
        outputState: outputDevices.length > 0 ? AudioDeviceState.Ready : AudioDeviceState.Missing,
      });

      await writeRendererLog("devices", "info", "Enumerated audio devices", {
        inputCount: inputDevices.length,
        outputCount: outputDevices.length,
        permissionState,
      });
    } catch (error) {
      if (!deviceRefreshVersion.isLatest(version)) return;
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
  toggleMicrophone: () =>
    set((state) =>
      state.phoneModeActive || state.isDeafened
        ? state
        : { isMuted: !state.isMuted, isManuallyMuted: !state.isMuted },
    ),
  toggleDeafen: () =>
    set((state) =>
      state.phoneModeActive
        ? state
        : state.isDeafened
          ? { isMuted: false, isDeafened: false, isManuallyMuted: false }
          : { isMuted: true, isDeafened: true, isManuallyMuted: false },
    ),
  deafenAndMute: () => set({ isMuted: true, isDeafened: true, isManuallyMuted: false }),
  undeafenAndUnmute: () =>
    set((state) =>
      state.phoneModeActive ? state : { isMuted: false, isDeafened: false, isManuallyMuted: false },
    ),
  setAudioState: ({ isMuted, isDeafened }) =>
    set((state) =>
      state.phoneModeActive
        ? state
        : { isDeafened, isMuted: isDeafened ? true : isMuted, isManuallyMuted: false },
    ),
  setMuted: (isMuted) =>
    set((state) => ({
      isMuted: state.phoneModeActive || state.isDeafened ? true : isMuted,
      isManuallyMuted: false,
    })),
  setDeafened: (isDeafened) =>
    set((state) =>
      state.phoneModeActive
        ? state
        : isDeafened
          ? { isMuted: true, isDeafened: true, isManuallyMuted: false }
          : { isMuted: state.isMuted, isDeafened: false },
    ),
  setNoiseSuppressionEnabled: (isNoiseSuppressionEnabled) => set({ isNoiseSuppressionEnabled }),
  setPushToTalkEnabled: (isPushToTalkEnabled) => set({ isPushToTalkEnabled }),
  setPushToTalkState: (pushToTalkState) => set({ pushToTalkState }),
  setLocalDiagnostics: (localDiagnostics) => set({ localDiagnostics }),
}));
