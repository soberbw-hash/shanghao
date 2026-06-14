import { useEffect, useMemo, useRef } from "react";

import { setAudioElementSinkId } from "@private-voice/webrtc";

import { useRoomStore } from "../../store/roomStore";
import { useAudioStore } from "../../store/audioStore";
import { useSettingsStore } from "../../store/settingsStore";

export const RemoteAudioRenderer = () => {
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const members = useRoomStore((state) => state.room.members);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const outputDeviceId = useSettingsStore((state) => state.settings?.preferredOutputDeviceId);
  const audioElementsRef = useRef<Record<string, HTMLAudioElement>>({});

  const streamEntries = useMemo(() => Object.entries(remoteStreams), [remoteStreams]);

  useEffect(() => {
    for (const [peerId, stream] of streamEntries) {
      const audioElement = audioElementsRef.current[peerId];
      if (!audioElement) {
        continue;
      }

      if (audioElement.srcObject !== stream) {
        audioElement.srcObject = stream;
      }

      const member = members.find((candidate) => candidate.id === peerId);
      audioElement.volume = member?.volume ?? 1;
      audioElement.muted = isDeafened;

      if (outputDeviceId) {
        void setAudioElementSinkId(audioElement, outputDeviceId);
      }
    }
  }, [isDeafened, members, outputDeviceId, streamEntries]);

  return (
    <>
      {streamEntries.map(([peerId]) => (
        <audio
          key={peerId}
          ref={(element) => {
            if (element) {
              audioElementsRef.current[peerId] = element;
            }
          }}
          autoPlay
          playsInline
          className="hidden"
        />
      ))}
    </>
  );
};
