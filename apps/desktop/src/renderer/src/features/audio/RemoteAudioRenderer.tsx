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
  useEffect(() => mixer.setOutputDevice(outputDeviceId), [mixer, outputDeviceId]);

  useEffect(() => {
    const unlock = () => void mixer.unlock("window-user-activation");
    const resumeWhenVisible = () => {
      if (document.visibilityState === "visible") void mixer.unlock("window-visible");
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    document.addEventListener("visibilitychange", resumeWhenVisible);
    void mixer.unlock("renderer-ready");
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      document.removeEventListener("visibilitychange", resumeWhenVisible);
    };
  }, [mixer]);

  useEffect(() => {
    const destroy = () => mixer.destroy();
    window.addEventListener("beforeunload", destroy, { once: true });
    return () => window.removeEventListener("beforeunload", destroy);
  }, [mixer]);

  return null;
};
