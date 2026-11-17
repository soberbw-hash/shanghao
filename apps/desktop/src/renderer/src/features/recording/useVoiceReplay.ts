import { useEffect, useRef, useState } from "react";
import { RoomConnectionState } from "@private-voice/shared";
import { useRoomStore } from "../../store/roomStore";
import { getRemoteAudioMixer } from "../audio/RemoteAudioMixer";
import { VoiceReplayCapture } from "./VoiceReplayCapture";
import { useAppStore } from "../../store/appStore";
import { readVoiceReplayShortcut } from "./voiceReplayShortcut";

let shortcutOwner: symbol | undefined;

export function useVoiceReplay() {
  const roomId = useRoomStore((state) => state.room.roomId);
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
  const manuallyStopped = useRef(false);
  const previousRoom = useRef(roomId);
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const [seconds, setSeconds] = useState<15 | 30 | 60>(30);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!enabled || !connected) return;
    const permitted = () => {
      const current = useRoomStore.getState();
      return (
        current.room.roomId === roomId &&
        current.room.connectionState === RoomConnectionState.Connected &&
        current.room.members
          .map((m) => m.id)
          .sort()
          .join("|") === members &&
        current.localStream === stream
      );
    };
    const next = new VoiceReplayCapture(permitted);
    capture.current = next;
    let active = true;
    void Promise.resolve()
      .then(() => next.start(track, getRemoteAudioMixer().getFinalOutputStream()))
      .then(() => {
        if (active) setStatus("");
      })
      .catch(() => {
        if (active) {
          setEnabled(false);
          setStatus("回溯缓冲未能开启，可在回溯设置中重试。");
          useAppStore.getState().pushToast({
            title: "语音回溯未能开启",
            description: "可在回溯设置中重试。",
            tone: "warning",
            dedupeKey: "voice-replay-start",
          });
        }
      });
    return () => {
      active = false;
      next.close();
      if (capture.current === next) capture.current = undefined;
    };
  }, [roomId, enabled, connected, members, stream]);
  useEffect(() => {
    if (previousRoom.current !== roomId) {
      manuallyStopped.current = false;
      previousRoom.current = roomId;
    }
    setEnabled(connected && !manuallyStopped.current);
  }, [connected, roomId]);
  const start = () => {
    manuallyStopped.current = false;
    setStatus("");
    setEnabled(true);
  };
  const stop = () => {
    manuallyStopped.current = true;
    setEnabled(false);
    capture.current?.close();
    capture.current = undefined;
    setStatus("本机缓冲已停止并清空。");
  };
  const save = async () => {
    if (saving.current) return;
    const api = window.desktopApi.voiceReplay;
    if (!api || !capture.current) {
      setStatus("声音还在准备中，请稍后再试。");
      useAppStore.getState().pushToast({
        title: enabled ? "语音回溯正在准备" : "语音回溯已关闭",
        description: enabled ? "请稍等片刻后再保存。" : "可在回溯设置中重新开启。",
        dedupeKey: "voice-replay-save",
      });
      return;
    }
    saving.current = true;
    try {
      const bytes = capture.current.snapshot(seconds);
      if (bytes.length <= 44) {
        setStatus("还没有可保存的声音，请稍等。");
        useAppStore.getState().pushToast({
          title: "还没有可保存的声音",
          description: "请稍等片刻后再保存。",
          dedupeKey: "voice-replay-save",
        });
        return;
      }
      await api.save(
        "刚才的对话 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        bytes,
      );
      setStatus("片段已保存在本机。");
      setRevision((value) => value + 1);
      useAppStore.getState().pushToast({
        title: `已保存刚才的 ${seconds} 秒`,
        description: "片段仅保存在本机，可回听或转成文字。",
        tone: "success",
        cardKind: "voice-replay",
        actionLabel: "立即查看",
        onAction: () => window.dispatchEvent(new Event("shanghao:open-voice-replay-library")),
      });
    } catch (error) {
      const message =
        error instanceof Error &&
        /voice_replay_(?:not_authorized|audio_stale|closed)/.test(error.message)
          ? "缓冲尚未就绪，请稍等片刻再保存。"
          : "片段未保存，请检查本机存储后重试。";
      setStatus(message);
      useAppStore.getState().pushToast({
        title: "片段没有保存",
        description: message,
        tone: "warning",
        dedupeKey: "voice-replay-save",
      });
    } finally {
      saving.current = false;
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const api = window.desktopApi.voiceReplay;
    if (!api) return;
    let active = true;
    const owner = Symbol("voice-replay-shortcut");
    shortcutOwner = owner;
    const unsubscribe = api.onSaveShortcut(() => {
      if (active && shortcutOwner === owner) void saveRef.current();
    });
    void api.shortcut(readVoiceReplayShortcut()).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
      if (shortcutOwner === owner) {
        shortcutOwner = undefined;
        void api.shortcut("").catch(() => undefined);
      }
    };
  }, []);
  return { save, start, stop, enabled, revision, status, setStatus, seconds, setSeconds };
}
