import { useEffect } from "react";

import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";

export const useAppBootstrap = (): void => {
  const hydrate = useSettingsStore((state) => state.hydrate);
  const settings = useSettingsStore((state) => state.settings);
  const refreshDevices = useAudioStore((state) => state.refreshDevices);
  const setNoiseSuppressionEnabled = useAudioStore(
    (state) => state.setNoiseSuppressionEnabled,
  );
  const setPushToTalkEnabled = useAudioStore((state) => state.setPushToTalkEnabled);

  useEffect(() => {
    void hydrate();
    void refreshDevices();

    const handleDeviceChange = () => {
      void refreshDevices();
    };

    navigator.mediaDevices?.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [hydrate, refreshDevices]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setNoiseSuppressionEnabled(settings.isNoiseSuppressionEnabled);
    setPushToTalkEnabled(settings.isPushToTalkEnabled);
  }, [setNoiseSuppressionEnabled, setPushToTalkEnabled, settings]);
};
