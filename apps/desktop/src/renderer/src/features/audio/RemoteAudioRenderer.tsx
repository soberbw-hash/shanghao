import { useEffect } from "react";

import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { getRemoteAudioMixer } from "./RemoteAudioMixer";

export const RemoteAudioRenderer = () => {
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const members = useRoomStore((state) => state.room.members);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const outputDeviceId = useSettingsStore((state) => state.settings?.preferredOutputDeviceId);
  const masterVolume = useSettingsStore((state) => state.settings?.speakerMasterVolume ?? 1);
  const loudnessBalanceEnabled = useSettingsStore(
    (state) => state.settings?.isFriendLoudnessBalanceEnabled ?? true,
  );
  const mixer = getRemoteAudioMixer();

  useEffect(() => {
    mixer.sync(
      Object.entries(remoteStreams).map(([peerId, stream]) => ({
        peerId,
        stream,
        volume: members.find((candidate) => candidate.id === peerId)?.volume ?? 1,
      })),
    );
  }, [members, mixer, remoteStreams]);

  useEffect(() => mixer.setDeafened(isDeafened), [isDeafened, mixer]);
  useEffect(() => {
    void mixer.setOutputDevice(outputDeviceId);
  }, [mixer, outputDeviceId]);
  useEffect(() => mixer.setMasterVolume(masterVolume), [masterVolume, mixer]);
  useEffect(
    () => mixer.setLoudnessBalanceEnabled(loudnessBalanceEnabled),
    [loudnessBalanceEnabled, mixer],
  );

  useEffect(() => {
    const unlock = () => void mixer.unlock("window-user-activation");
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible") void mixer.unlock("window-visible");
    };
    const recoverOutput = () => mixer.recoverOutputDevice();
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    document.addEventListener("visibilitychange", resumeWhenVisible);
    navigator.mediaDevices?.addEventListener?.("devicechange", recoverOutput);
    void mixer.unlock("renderer-ready");
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
      navigator.mediaDevices?.removeEventListener?.("devicechange", recoverOutput);
    };
  }, [mixer]);

  useEffect(() => {
    const destroy = () => mixer.destroy();
    window.addEventListener("beforeunload", destroy, { once: true });
    return () => window.removeEventListener("beforeunload", destroy);
  }, [mixer]);

  return null;
};
