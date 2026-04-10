import { useEffect, useMemo, useRef } from "react";

import { setAudioElementSinkId } from "@private-voice/webrtc";

import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";

export const RemoteAudioRenderer = () => {
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const members = useRoomStore((state) => state.room.members);
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

      if (outputDeviceId) {
        void setAudioElementSinkId(audioElement, outputDeviceId);
      }
    }
  }, [members, outputDeviceId, streamEntries]);

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
