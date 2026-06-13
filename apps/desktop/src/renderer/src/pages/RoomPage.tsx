import { useState } from "react";

import { RoomConnectionState } from "@private-voice/shared";

import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkKeyBadge } from "../components/audio/PushToTalkKeyBadge";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { Button } from "../components/base/Button";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { InlineBanner } from "../components/layout/InlineBanner";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { ConnectionHealthStrip } from "../components/room/ConnectionHealthStrip";
import { MemberGrid } from "../components/room/MemberGrid";
import { useRoomState } from "../hooks/useRoomState";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

export const RoomPage = () => {
  const { room, leaveRoom, replaceInputDevice, sendChatMessage } = useRoomState();
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const connectionHealth = useRoomStore((state) => state.connectionHealth);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isPushToTalkEnabled,
    toggleMute,
    setPushToTalkEnabled,
  } = useAudioStore();
  const [chatInput, setChatInput] = useState("");

  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;

  const handleSendChat = () => {
    const content = chatInput.trim();
    if (!content) {
      return;
    }
    void sendChatMessage(content).then(() => setChatInput(""));
  };

  return (
    <PageContainer className="min-h-0 gap-3 overflow-hidden py-2.5">
      <TopStatusBar variant="room" />
      {room.connectionState === RoomConnectionState.Reconnecting ||
      room.connectionState === RoomConnectionState.Degraded ? (
        <InlineBanner tone="warning">网络有波动，正在自动恢复频道连接。</InlineBanner>
      ) : null}
      {room.connectionState === RoomConnectionState.Failed ? (
        <InlineBanner tone="danger">连接失败，请检查网络或频道服务器设置后重新进入。</InlineBanner>
      ) : null}

      <section className="grid min-h-0 flex-1 items-stretch gap-4 xl:grid-cols-[1.12fr_0.88fr]">
        <div className="surface-card flex min-h-[350px] flex-col p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[22px] font-semibold text-[#111827]">队伍</div>
              <div className="mt-1 text-sm text-[#667085]">谁在线、谁在说话，一眼就能看到。</div>
            </div>
            <div className="status-capsule">{room.memberCount}/5 在线</div>
          </div>
          <div className="mt-5">
            <MemberGrid members={room.members} onVolumeChange={(memberId, value) => updateMemberVolume(memberId, value)} />
          </div>
          <div className="mt-auto pt-5">
            <ConnectionHealthStrip
              latencyMs={connectionHealth.latencyMs}
              jitterMs={connectionHealth.jitterMs}
              packetLossPercent={connectionHealth.packetLossPercent}
            />
          </div>
        </div>

        <TemporaryChatPanel
          className="h-full"
          messages={chatMessages}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSend={handleSendChat}
          onQuickSend={(message) => void sendChatMessage(message)}
          emptyMessage="发一句，叫大家上号。"
          canSend={canSend}
          unavailableLabel={room.connectionState === RoomConnectionState.Reconnecting ? "重连中" : "连接已断开"}
        />
      </section>

      <BottomControlDock>
        <div className="flex items-center gap-3">
          <MuteButton isMuted={isMuted} onClick={toggleMute} />
          <PushToTalkToggle
            isEnabled={isPushToTalkEnabled}
            onClick={() => {
              setPushToTalkEnabled(!isPushToTalkEnabled);
              void saveSettings({ isPushToTalkEnabled: !isPushToTalkEnabled });
            }}
          />
          {isPushToTalkEnabled ? <PushToTalkKeyBadge shortcut={settings?.pushToTalkShortcut || "Space"} /> : null}
        </div>
        <div className="grid min-w-[280px] flex-1 gap-3 md:grid-cols-2">
          <InputDevicePicker
            devices={inputDevices}
            value={settings?.preferredInputDeviceId}
            onChange={(preferredInputDeviceId) => {
              void saveSettings({ preferredInputDeviceId }).then(() => replaceInputDevice(preferredInputDeviceId));
            }}
          />
          <OutputDevicePicker
            devices={outputDevices}
            value={settings?.preferredOutputDeviceId}
            onChange={(preferredOutputDeviceId) => void saveSettings({ preferredOutputDeviceId })}
          />
        </div>
        <Button variant="danger" onClick={() => void leaveRoom()}>
          退出频道
        </Button>
      </BottomControlDock>
    </PageContainer>
  );
};
