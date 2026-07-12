import { useEffect } from "react";

import { desktopApi } from "../utils/desktopApi";
import { useAudioStore } from "../store/audioStore";

export const useGlobalMuteSync = (): void => {
  const toggleMicrophone = useAudioStore((state) => state.toggleMicrophone);

  useEffect(
    () => desktopApi.shortcuts.onMuteTriggered(() => toggleMicrophone()),
    [toggleMicrophone],
  );
};
