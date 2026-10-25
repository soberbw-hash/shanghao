import { useEffect, useState } from "react";
import { PushToTalkState } from "@private-voice/shared";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { getMicrophoneStatus } from "./microphoneStatus";
import { observeMicrophoneStatus, type MicrophoneStreamStatus } from "./microphoneStatusObserver";

export const useMicrophoneStatus = (isMuted: boolean) => {
  const stream = useRoomStore((state) => state.localStream);
  const connection = useRoomStore((state) => state.room.connectionState);
  const permission = useAudioStore((state) => state.permissionState);
  const inputState = useAudioStore((state) => state.inputState);
  const pushToTalk = useAudioStore((state) => state.isPushToTalkEnabled);
  const pushToTalkState = useAudioStore((state) => state.pushToTalkState);
  const [observed, setObserved] = useState<MicrophoneStreamStatus & { stream: MediaStream }>();
  useEffect(() => {
    if (!stream) return;
    return observeMicrophoneStatus(stream, window, (status) => setObserved({ stream, ...status }));
  }, [stream]);
  return getMicrophoneStatus({
    isMuted,
    connection,
    permission,
    inputState,
    pushToTalkWaiting:
      pushToTalk && ![PushToTalkState.Pressed, PushToTalkState.Locked].includes(pushToTalkState),
    tracks: stream?.getAudioTracks() ?? [],
    inputLost: observed?.stream === stream && Boolean(observed?.inputLost),
  });
};
