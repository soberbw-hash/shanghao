import { useEffect, useState } from "react";
import {
  MemberSpeakingState,
  RoomConnectionState,
  resolveAsrGameLexicon,
  normalizeAsrGameLexicon,
} from "@private-voice/shared";
import { useSettingsStore } from "../../store/settingsStore";
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
    if (!transport || !sessionId || !localId || !connected || participating || !stream) return;
    void transport.joinAutomatically(sessionId).catch(() => setStatus("转录连接失败，请重试"));
  }, [transport, sessionId, localId, connected, participating, stream]);
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
      () => {
        const gameName = useRoomStore
          .getState()
          .room.members.find((member) => member.id === localId)?.gameName;
        if (!gameName) return undefined;
        const saved = resolveAsrGameLexicon(
          useSettingsStore.getState().settings?.aiAsrGameLexicon,
          gameName,
        );
        return normalizeAsrGameLexicon([{ gameName, terms: saved?.terms ?? [] }])[0];
      },
    );
    setStatus("正在记录，稍后汇总");
    capture.start();
    return () => capture.stop();
  }, [roomId, localId, sessionId, participating, connected, stream, transport]);
  return status;
}
