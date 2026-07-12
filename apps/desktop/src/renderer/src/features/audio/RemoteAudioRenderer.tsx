import { useEffect, useRef } from "react";

import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";

type SinkAwareAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const RemoteAudioTrack = ({
  stream,
  volume,
  isDeafened,
  outputDeviceId,
}: {
  stream: MediaStream;
  volume: number;
  isDeafened: boolean;
  outputDeviceId?: string;
}) => {
  const elementRef = useRef<HTMLAudioElement>(null);
  const contextRef = useRef<SinkAwareAudioContext>();
  const gainRef = useRef<GainNode>();

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const context = new AudioContext({ latencyHint: "interactive" }) as SinkAwareAudioContext;
    const source = context.createMediaElementSource(element);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    element.srcObject = stream;
    element.volume = 1;
    contextRef.current = context;
    gainRef.current = gain;
    void context
      .resume()
      .then(() => element.play())
      .catch(() => undefined);

    return () => {
      element.srcObject = null;
      source.disconnect();
      gain.disconnect();
      contextRef.current = undefined;
      gainRef.current = undefined;
      void context.close().catch(() => undefined);
    };
  }, [stream]);

  useEffect(() => {
    const gain = gainRef.current;
    const context = contextRef.current;
    if (!gain || !context) return;
    gain.gain.setTargetAtTime(
      isDeafened ? 0 : Math.max(0, Math.min(2, volume)),
      context.currentTime,
      0.012,
    );
  }, [isDeafened, volume]);

  useEffect(() => {
    const context = contextRef.current;
    if (outputDeviceId && context?.setSinkId) {
      void context.setSinkId(outputDeviceId).catch(() => undefined);
    }
  }, [outputDeviceId]);

  return <audio ref={elementRef} autoPlay playsInline className="hidden" />;
};

export const RemoteAudioRenderer = () => {
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const members = useRoomStore((state) => state.room.members);
  const isDeafened = useAudioStore((state) => state.isDeafened);
  const outputDeviceId = useSettingsStore((state) => state.settings?.preferredOutputDeviceId);

  return (
    <>
      {Object.entries(remoteStreams).map(([peerId, stream]) => {
        const member = members.find((candidate) => candidate.id === peerId);
        return (
          <RemoteAudioTrack
            key={peerId}
            stream={stream}
            volume={member?.volume ?? 1}
            isDeafened={isDeafened}
            outputDeviceId={outputDeviceId}
          />
        );
      })}
    </>
  );
};
