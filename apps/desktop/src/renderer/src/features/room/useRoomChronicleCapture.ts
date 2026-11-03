import { useEffect, useState } from "react";
import { MemberSpeakingState, RoomConnectionState } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import type { RoomChronicleClient } from "./RoomChronicleClient";
import { ChronicleMicrophoneCapture } from "./ChronicleMicrophoneCapture";

export function useRoomChronicleCapture(transport?: RoomChronicleClient): string {
  const roomId = useRoomStore((state) => state.room.roomId);
  const localId = useRoomStore((state) => state.room.members.find((member) => member.isLocal)?.id);
  const connected = useRoomStore(
    (state) => state.room.connectionState === RoomConnectionState.Connected,
  );
  const sessionId = useRoomStore((state) => state.chronicle?.state?.sessionId);
  const participants = useRoomStore((state) => state.chronicle?.state?.participants);
  const participating = !!localId && !!participants?.includes(localId);
  const stream = useRoomStore((state) => state.localStream);
  const [status, setStatus] = useState("");
  useEffect(() => {
    setStatus("");
    const track = stream?.getAudioTracks()[0];
    if (!transport || !sessionId || !participating || !connected || !track) return;
    const capture = new ChronicleMicrophoneCapture(
      track,
      sessionId,
      () =>
        useRoomStore.getState().room.members.find((member) => member.id === localId)
          ?.speakingState === MemberSpeakingState.Speaking,
      (part) => transport.audio(part),
      setStatus,
    );
    setStatus("正在记录，稍后汇总");
    capture.start();
    return () => capture.stop();
  }, [roomId, localId, sessionId, participating, connected, stream, transport]);
  return status;
}
