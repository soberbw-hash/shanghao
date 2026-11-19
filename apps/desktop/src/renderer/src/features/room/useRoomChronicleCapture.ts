import { useEffect, useRef, useState } from "react";
import {
  MemberSpeakingState,
  RoomConnectionState,
  resolveAsrGameLexicon,
  normalizeAsrGameLexicon,
} from "@private-voice/shared";
import { useSettingsStore } from "../../store/settingsStore";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import type { RoomChronicleClient } from "./RoomChronicleClient";
import { ChronicleMicrophoneCapture } from "./ChronicleMicrophoneCapture";

export function useRoomChronicleCapture(transport?: RoomChronicleClient): string {
  const roomId = useRoomStore((state) => state.room.roomId);
  const localId = useRoomStore((state) => state.room.members.find((member) => member.isLocal)?.id);
  const connected = useRoomStore(
    (state) =>
      state.room.connectionState === RoomConnectionState.Connected ||
      state.room.connectionState === RoomConnectionState.WaitingPeer ||
      state.room.connectionState === RoomConnectionState.Degraded,
  );
  const sessionId = useRoomStore((state) => state.chronicle?.state?.sessionId);
  const participants = useRoomStore((state) => state.chronicle?.state?.participants);
  const participating = !!localId && !!participants?.includes(localId);
  const stream = useRoomStore((state) => state.localStream);
  const notifiedSession = useRef<string>(undefined);
  const [status, setStatus] = useState("");
  useEffect(() => {
    if (!transport || !sessionId || !localId || !connected || participating) return;
    let active = true;
    const join = () => {
      if (!stream?.getAudioTracks().some((track) => track.readyState === "live")) return;
      void transport.joinAutomatically(sessionId).catch(() => {
        if (active) setStatus("转录连接中，正在重试");
      });
    };
    join();
    const retry = window.setInterval(join, 10_000);
    return () => {
      active = false;
      window.clearInterval(retry);
    };
  }, [transport, sessionId, localId, connected, participating, stream]);
  useEffect(() => {
    setStatus("");
    const track = stream?.getAudioTracks().find((item) => item.readyState === "live");
    if (!transport || !sessionId || !participating || !connected || !track) return;
    if (notifiedSession.current !== sessionId) {
      notifiedSession.current = sessionId;
      useAppStore.getState().pushToast({
        tone: "neutral",
        title: "已参与房间转录",
        description: "可在纪事里停止提供自己的语音。",
      });
    }
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
