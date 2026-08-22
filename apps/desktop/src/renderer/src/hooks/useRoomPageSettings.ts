import { useMemo } from "react";

import type { RoomDockSettings } from "../components/room/RoomDock";
import { useSettingsStore } from "../store/settingsStore";

export const useRoomPageSettings = () => {
  const isWorkActivityVisible = useSettingsStore((state) => state.settings?.isWorkActivityVisible);
  const isAiAutoTranscribeEnabled = useSettingsStore(
    (state) => state.settings?.isAiAutoTranscribeEnabled,
  );
  const isAiAutoOrganizeEnabled = useSettingsStore(
    (state) => state.settings?.isAiAutoOrganizeEnabled,
  );
  const isAutoRecordOnJoinEnabled = useSettingsStore(
    (state) => state.settings?.isAutoRecordOnJoinEnabled,
  );
  const isNoiseSuppressionEnabled = useSettingsStore(
    (state) => state.settings?.isNoiseSuppressionEnabled,
  );
  const preferredInputDeviceId = useSettingsStore(
    (state) => state.settings?.preferredInputDeviceId,
  );
  const recordingSaveDirectory = useSettingsStore(
    (state) => state.settings?.recordingSaveDirectory,
  );
  const microphoneSendVolume = useSettingsStore((state) => state.settings?.microphoneSendVolume);
  const isEchoCancellationEnabled = useSettingsStore(
    (state) => state.settings?.isEchoCancellationEnabled,
  );
  const isVoiceEnhancementEnabled = useSettingsStore(
    (state) => state.settings?.isVoiceEnhancementEnabled,
  );
  const isAutoGainControlEnabled = useSettingsStore(
    (state) => state.settings?.isAutoGainControlEnabled,
  );
  const preferredOutputDeviceId = useSettingsStore(
    (state) => state.settings?.preferredOutputDeviceId,
  );
  const speakerMasterVolume = useSettingsStore((state) => state.settings?.speakerMasterVolume);
  const isFriendLoudnessBalanceEnabled = useSettingsStore(
    (state) => state.settings?.isFriendLoudnessBalanceEnabled,
  );

  const roomDockSettings = useMemo<RoomDockSettings | undefined>(() => {
    if (isNoiseSuppressionEnabled === undefined) return undefined;
    return {
      preferredInputDeviceId,
      microphoneSendVolume: microphoneSendVolume ?? 1,
      isNoiseSuppressionEnabled,
      isEchoCancellationEnabled: isEchoCancellationEnabled ?? true,
      isVoiceEnhancementEnabled: isVoiceEnhancementEnabled ?? true,
      isAutoGainControlEnabled: isAutoGainControlEnabled ?? true,
      preferredOutputDeviceId,
      speakerMasterVolume: speakerMasterVolume ?? 1,
      isFriendLoudnessBalanceEnabled: isFriendLoudnessBalanceEnabled ?? true,
    };
  }, [
    isNoiseSuppressionEnabled,
    preferredInputDeviceId,
    microphoneSendVolume,
    isEchoCancellationEnabled,
    isVoiceEnhancementEnabled,
    isAutoGainControlEnabled,
    preferredOutputDeviceId,
    speakerMasterVolume,
    isFriendLoudnessBalanceEnabled,
  ]);

  return {
    isWorkActivityVisible,
    isAiAutoTranscribeEnabled,
    isAiAutoOrganizeEnabled,
    isAutoRecordOnJoinEnabled,
    isNoiseSuppressionEnabled,
    preferredInputDeviceId,
    recordingSaveDirectory,
    roomDockSettings,
  };
};
