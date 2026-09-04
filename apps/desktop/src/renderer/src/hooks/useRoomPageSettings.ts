import { useMemo } from "react";

import type { RoomDockSettings } from "../components/room/RoomDock";
import { useSettingsStore } from "../store/settingsStore";

export const useRoomPageSettings = () => {
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
  const isPushToTalkEnabled = useSettingsStore((state) => state.settings?.isPushToTalkEnabled);
  const pushToTalkShortcut = useSettingsStore((state) => state.settings?.pushToTalkShortcut);
  const micEqualizerGains = useSettingsStore((state) => state.settings?.micEqualizerGains);
  const lowCutFrequency = useSettingsStore((state) => state.settings?.lowCutFrequency);
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
      isPushToTalkEnabled: isPushToTalkEnabled ?? false,
      pushToTalkShortcut: pushToTalkShortcut || "Space",
      micEqualizerGains: micEqualizerGains ?? [0, 0, 0, 0, 0],
      lowCutFrequency: lowCutFrequency ?? "75",
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
    isPushToTalkEnabled,
    pushToTalkShortcut,
    micEqualizerGains,
    lowCutFrequency,
    preferredOutputDeviceId,
    speakerMasterVolume,
    isFriendLoudnessBalanceEnabled,
  ]);

  return {
    isAiAutoTranscribeEnabled,
    isAiAutoOrganizeEnabled,
    isAutoRecordOnJoinEnabled,
    isNoiseSuppressionEnabled,
    preferredInputDeviceId,
    recordingSaveDirectory,
    roomDockSettings,
  };
};
