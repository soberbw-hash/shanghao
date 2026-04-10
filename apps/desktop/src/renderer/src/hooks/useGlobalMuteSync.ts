import { useEffect } from "react";

import { desktopApi } from "../utils/desktopApi";
import { useAudioStore } from "../store/audioStore";

export const useGlobalMuteSync = (): void => {
  const toggleMute = useAudioStore((state) => state.toggleMute);

  useEffect(() => desktopApi.shortcuts.onMuteTriggered(() => toggleMute()), [toggleMute]);
};
