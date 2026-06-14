import { useEffect, useRef, useState } from "react";
import { Headphones, LogOut, MonitorUp, Volume2 } from "lucide-react";

import { RecordingEncoderState, RecordingState, RoomConnectionState } from "@private-voice/shared";

import { MuteButton } from "../components/audio/MuteButton";
import { RecordingButton } from "../components/audio/RecordingButton";
import { Button } from "../components/base/Button";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { TeamIsland } from "../components/room/TeamIsland";
import { playUiSound } from "../features/audio/uiSound";
import { useRecordingController } from "../hooks/useRecordingController";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

const KNOCK_COOLDOWN_MS = 5_000;

export const RoomPage = () => {
  const { room, leaveRoom, sendChatMessage, sendKnock, replaceInputDevice } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const { inputDevices, outputDevices, isMuted, toggleMute } = useAudioStore();
  const recordingStatus = useRecordingStore((state) => state.status);
  const { capability, startRecording, stopRecording } = useRecordingController();
  const [chatInput, setChatInput] = useState("");
  const enteredAt = useRef(Date.now());
  const lastKnockAt = useRef(0);

  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;

  useEffect(() => {
    void window.desktopApi.overlay.update({
      members: room.members,
      isMuted,
      connectionState: room.connectionState,
    });
  }, [isMuted, room.connectionState, room.members]);

  const send = async (content = chatInput) => {
    if (!content.trim()) return;
    await sendChatMessage(content);
    playUiSound("message");
    if (content === chatInput) setChatInput("");
  };

  const knock = async () => {
    const remaining = KNOCK_COOLDOWN_MS - (Date.now() - lastKnockAt.current);
    if (remaining > 0) {
      pushToast({
        tone: "neutral",
        title: "刚刚已经敲过啦",
        description: `${Math.ceil(remaining / 1000)} 秒后可以再敲一次。`,
      });
      return;
    }
    lastKnockAt.current = Date.now();
    await sendKnock();
  };

  const invite = async () => {
    const address = settings?.relayServerUrl?.trim();
    if (!address) {
      pushToast({
        tone: "warning",
        title: "没有可用的服务器地址",
        description: "请返回进入页检查地址。",
      });
      return;
    }
    await navigator.clipboard.writeText(`上号服务器：${address}`);
    pushToast({
      tone: "success",
      title: "服务器地址已复制",
      description: "发给朋友即可进入同一个频道。",
    });
  };

  const toggleRecording = async () => {
    try {
      if (recordingStatus.state === RecordingState.Recording) {
        await stopRecording();
        playUiSound("record-stop");
        pushToast({
          tone: "success",
          title: "录音已保存",
          description: "可以在保存记录中查看。",
        });
        return;
      }

      startRecording();
      playUiSound("record-start");
      pushToast({ tone: "neutral", title: "开始录音", description: "会录下当前频道的混合语音。" });
    } catch {
      pushToast({ tone: "danger", title: "录音失败", description: "请稍后再试。" });
    }
  };

  const leave = async () => {
    localStorage.setItem(
      "shanghao:last-session-note",
      JSON.stringify({
        people: room.memberCount,
        minutes: Math.max(1, Math.round((Date.now() - enteredAt.current) / 60_000)),
      }),
    );
    await window.desktopApi.overlay.close();
    await leaveRoom();
  };

  const switchInputDevice = async (preferredInputDeviceId?: string) => {
    await saveSettings({ preferredInputDeviceId });
    await replaceInputDevice(preferredInputDeviceId);
    playUiSound("connected");
    pushToast({ tone: "success", title: "麦克风已切换", description: "新的输入设备已经生效。" });
  };

  const switchOutputDevice = async (preferredOutputDeviceId?: string) => {
    await saveSettings({ preferredOutputDeviceId });
    playUiSound("connected");
    pushToast({ tone: "success", title: "扬声器已切换", description: "新的输出设备已经生效。" });
  };

  return (
    <div className="room-page relative flex h-full flex-col gap-2.5 overflow-hidden px-3.5 pb-3.5 pt-2">
      <TopStatusBar onKnock={() => void knock()} onInvite={() => void invite()} />

      <main className="grid min-h-0 flex-1 gap-2.5 lg:grid-cols-[minmax(0,1.44fr)_minmax(280px,.56fr)]">
        <section className="island-panel min-h-0 overflow-hidden">
          <TeamIsland members={room.members} />
        </section>
        <TemporaryChatPanel
          className="h-full"
          messages={chatMessages}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSend={() => void send()}
          onQuickSend={(message) => void send(message)}
          canSend={canSend}
          unavailableLabel="正在重连..."
        />
      </main>

      <footer className="voice-dock flex items-center gap-2.5 px-3.5 py-2.5">
        <MuteButton isMuted={isMuted} onClick={toggleMute} />
        <label className="device-select" title="选择麦克风">
          <Headphones className="h-4 w-4" />
          <select
            value={settings?.preferredInputDeviceId || ""}
            onChange={(event) => {
              const preferredInputDeviceId = event.target.value || undefined;
              void switchInputDevice(preferredInputDeviceId);
            }}
          >
            <option value="">默认麦克风</option>
            {inputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.label || "麦克风"}</option>
            ))}
          </select>
        </label>
        <label className="device-select" title="选择扬声器">
          <Volume2 className="h-4 w-4" />
          <select
            value={settings?.preferredOutputDeviceId || ""}
            onChange={(event) => void switchOutputDevice(event.target.value || undefined)}
          >
            <option value="">默认扬声器</option>
            {outputDevices.map((device) => (
              <option key={device.id} value={device.id}>{device.label || "扬声器"}</option>
            ))}
          </select>
        </label>
        <div className="audio-level-bars" aria-label="输入音量">
          <i /><i /><i /><i />
        </div>
        <div className="flex-1" />
        <RecordingButton
          isRecording={recordingStatus.state === RecordingState.Recording}
          onClick={() => void toggleRecording()}
          disabled={capability.encoderState === RecordingEncoderState.Unsupported}
        />
        <Button
          variant="ghost"
          className="voice-action-button whitespace-nowrap"
          title="悬浮小窗"
          onClick={() => void window.desktopApi.overlay.toggle()}
        >
          <MonitorUp className="h-4 w-4" />
          <span className="voice-action-label">悬浮小窗</span>
        </Button>
        <Button
          variant="danger"
          className="voice-action-button whitespace-nowrap"
          title="退出频道"
          onClick={() => void leave()}
        >
          <LogOut className="h-4 w-4" />
          <span className="voice-action-label">退出频道</span>
        </Button>
      </footer>

    </div>
  );
};
