import { useEffect, useRef, useState } from "react";
import { RoomConnectionState } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { getRemoteAudioMixer } from "../audio/RemoteAudioMixer";
import { VoiceReplayCapture } from "./VoiceReplayCapture";
import { useAppStore } from "../../store/appStore";

export function useVoiceReplay() {
  const roomId = useRoomStore((state) => state.room.roomId);
  const state = useRoomStore((store) => store.replay?.state);
  const connected = useRoomStore(
    (store) => store.room.connectionState === RoomConnectionState.Connected,
  );
  const members = useRoomStore((store) =>
    store.room.members
      .map((m) => m.id)
      .sort()
      .join("|"),
  );
  const stream = useRoomStore((store) => store.localStream);
  const capture = useRef<VoiceReplayCapture | undefined>(undefined);
  const saving = useRef(false);
  const [status, setStatus] = useState("");
  const [seconds, setSeconds] = useState<15 | 30 | 60>(30);
  const [revision, setRevision] = useState(0);
  const consentKey =
    state &&
    JSON.stringify([
      roomId,
      state.sessionId,
      state.epoch,
      state.members,
      state.approved,
      state.enabled,
    ]);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!state?.enabled || !connected || !track || members !== [...state.members].sort().join("|"))
      return;
    const permitted = () => {
      const current = useRoomStore.getState();
      const next = current.replay?.state;
      return (
        current.room.roomId === roomId &&
        current.room.connectionState === RoomConnectionState.Connected &&
        current.room.members
          .map((m) => m.id)
          .sort()
          .join("|") === members &&
        !!next?.enabled &&
        next.sessionId === state.sessionId &&
        next.epoch === state.epoch
      );
    };
    const next = new VoiceReplayCapture(state, permitted);
    capture.current = next;
    let active = true;
    void Promise.resolve()
      .then(() => next.start(track, getRemoteAudioMixer().getFinalOutputStream()))
      .then(() => {
        if (active) setStatus("");
      })
      .catch(() => {
        if (active) setStatus("回溯缓冲未能开启，可关闭后重试。");
      });
    return () => {
      active = false;
      next.close();
      if (capture.current === next) capture.current = undefined;
    };
    // consentKey is the stable identity of a server-confirmed generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, consentKey, connected, members, stream]);
  const save = async () => {
    if (saving.current) return;
    const api = window.desktopApi.voiceReplay;
    if (!api || !capture.current) {
      setStatus("全员同意后才能保存回溯。");
      useAppStore.getState().pushToast({
        title: "语音回溯尚未开启",
        description: "请先邀请房间成员同意。",
        dedupeKey: "voice-replay-save",
      });
      return;
    }
    saving.current = true;
    try {
      const bytes = capture.current.snapshot(seconds);
      if (bytes.length <= 44) {
        setStatus("还没有可保存的声音，请稍等。");
        return;
      }
      await api.save(
        "刚才的对话 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        bytes,
      );
      setStatus("片段已保存在本机。");
      setRevision((value) => value + 1);
      useAppStore.getState().pushToast({
        title: "已保存刚才的对话",
        description: "可在语音回溯中回听，仅存本机。",
        tone: "success",
      });
    } catch (error) {
      setStatus(
        error instanceof Error &&
          /voice_replay_(?:not_authorized|audio_stale|closed)/.test(error.message)
          ? "缓冲尚未就绪，请稍等片刻再保存。"
          : "片段未保存，请检查本机存储后重试。",
      );
    } finally {
      saving.current = false;
    }
  };
  useEffect(() => {
    void window.desktopApi.voiceReplay?.shortcut("").catch(() => undefined);
  }, []);
  return { save, revision, status, setStatus, seconds, setSeconds };
}
