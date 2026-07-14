import { useEffect, useRef } from "react";

import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { writeRendererLog } from "../../utils/logger";

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
  const contextRef = useRef<SinkAwareAudioContext>();
  const gainRef = useRef<GainNode>();

  useEffect(() => {
    let context: SinkAwareAudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    try {
      context = new AudioContext({ latencyHint: "interactive" }) as SinkAwareAudioContext;
      source = context.createMediaStreamSource(stream);
      gain = context.createGain();
      source.connect(gain);
      gain.connect(context.destination);
      contextRef.current = context;
      gainRef.current = gain;
      void context.resume().catch(() => undefined);
    } catch (error) {
      void writeRendererLog("audio", "error", "Failed to attach remote audio stream", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return () => {
      source?.disconnect();
      gain?.disconnect();
      contextRef.current = undefined;
      gainRef.current = undefined;
      void context?.close().catch(() => undefined);
    };
  }, [stream]); // Audio nodes are recreated only when the remote MediaStream identity changes.

  useEffect(() => {
    const gain = gainRef.current;
    const context = contextRef.current;
    if (!gain || !context) return;
    gain.gain.setTargetAtTime(
      isDeafened ? 0 : Math.max(0, Math.min(2, volume)),
      context.currentTime,
      0.012,
    );
  }, [isDeafened, stream, volume]);

  useEffect(() => {
    const context = contextRef.current;
    if (outputDeviceId && context?.setSinkId) {
      void context.setSinkId(outputDeviceId).catch(() => undefined);
    }
  }, [outputDeviceId, stream]);

  return null;
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
