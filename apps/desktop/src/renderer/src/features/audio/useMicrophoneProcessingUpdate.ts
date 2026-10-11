import { useRef } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import {
  applyMicrophoneProcessingPatch,
  type MicrophoneProcessingPatch,
} from "./microphoneSettingsTransaction";

/** Serialize processing changes across all microphone controls, including failed saves. */
export const useMicrophoneProcessingUpdate = (replaceInput: () => Promise<boolean>) => {
  const inFlight = useRef(false);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const isProcessingBusy = () => inFlight.current;
  const applyProcessingPatch = async (patch: MicrophoneProcessingPatch): Promise<boolean> => {
    if (inFlight.current) return false;
    inFlight.current = true;
    try {
      return await applyMicrophoneProcessingPatch(patch, {
        getSettings: () => useSettingsStore.getState().settings,
        saveSettings,
        apply: replaceInput,
      });
    } finally {
      inFlight.current = false;
    }
  };
  return { applyProcessingPatch, isProcessingBusy };
};
