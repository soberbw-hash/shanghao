import { useState } from "react";
import { ArrowRight, Radio, Settings2, ShieldCheck } from "lucide-react";

import { RoomConnectionState } from "@private-voice/shared";

import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { AvatarPlaceholder } from "../components/base/AvatarPlaceholder";
import { Button } from "../components/base/Button";
import { Input } from "../components/base/Input";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { InlineBanner } from "../components/layout/InlineBanner";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { MemberGrid } from "../components/room/MemberGrid";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { getAvatarSrc } from "../utils/profile";

export const HomePage = () => {
  const { room, joinChannel, replaceInputDevice, sendChatMessage } = useRoomState();
  const roomAction = useAppStore((state) => state.roomAction);
  const navigate = useAppStore((state) => state.navigate);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const chatMessages = useRoomStore((state) => state.chatMessages);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isPushToTalkEnabled,
    toggleMute,
    setPushToTalkEnabled,
  } = useAudioStore();
  const [chatInput, setChatInput] = useState("");

  if (!settings) {
    return <StartupSplashPage message="正在准备开黑频道…" />;
  }

  const isJoining = roomAction === "joining";
  const hasServer = Boolean(settings.relayServerUrl?.trim());
  const canSend =
    room.connectionState === RoomConnectionState.Connected ||
    room.connectionState === RoomConnectionState.WaitingPeer ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;

  const handleSendChat = () => {
    const message = chatInput.trim();
    if (!message) {
      return;
    }
    void sendChatMessage(message).then(() => setChatInput(""));
  };

  return (
    <PageContainer className="min-h-0 gap-3 overflow-hidden py-2.5">
      <TopStatusBar />

      {!hasServer ? (
        <InlineBanner tone="warning">
          固定频道还差一个服务器地址。打开设置填写后，所有好友就能直接进入同一个频道。
        </InlineBanner>
      ) : null}

      <section className="grid items-stretch gap-4 xl:grid-cols-2">
        <div
          className="surface-card flex min-h-[350px] flex-col p-5"
          data-testid="home-channel-card"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[22px] font-semibold text-[#111827]">
                <Radio className="h-5 w-5 text-[#4DA3FF]" />
                进入开黑频道
              </div>
              <p className="mt-1 text-sm text-[#667085]">打开上号，进入频道，等朋友上线。</p>
            </div>
            <div className="status-capsule">
              <ShieldCheck className="h-4 w-4 text-[#2F9E68]" />
              固定好友频道
            </div>
          </div>

          <div className="mt-5 flex items-center gap-4 rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
            <AvatarPlaceholder
              name={settings.nickname}
              src={getAvatarSrc(settings.avatarId)}
              size="lg"
              className="h-16 w-16"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-[#111827]">{settings.nickname}</div>
              <div className="mt-1 text-sm text-[#667085]">你的资料已准备好</div>
            </div>
            <Button variant="ghost" onClick={() => navigate("settings")}>
              <Settings2 className="h-4 w-4" />
              修改资料
            </Button>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-sm font-medium text-[#111827]">频道码</div>
            <Input
              value={settings.channelAccessCode}
              placeholder="如果好友频道设置了频道码，请在这里填写"
              type="password"
              onChange={(event) => void saveSettings({ channelAccessCode: event.target.value })}
            />
            <div className="mt-2 text-xs text-[#98A2B3]">频道码只保存在本机，不会写入日志或诊断包。</div>
          </div>

          <div className="mt-auto flex items-center justify-between gap-3 pt-5">
            <div className="text-sm text-[#667085]">
              {hasServer ? "频道已准备好，进入后会自动连接好友。" : "先设置频道服务器即可使用。"}
            </div>
            <Button onClick={() => void joinChannel()} disabled={isJoining}>
              {isJoining ? "正在进入…" : "进入频道"}
              <ArrowRight className="h-4 w-4" />
            </Button>
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
          unavailableLabel={room.connectionState === RoomConnectionState.Reconnecting ? "重连中" : "进入后发送"}
        />
      </section>

      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between text-sm font-medium text-[#667085]">
          <span>队伍</span>
          <span>{room.memberCount}/5 在线</span>
        </div>
        <MemberGrid members={room.members} onVolumeChange={(memberId, value) => updateMemberVolume(memberId, value)} />
      </div>

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
        </div>
        <div className="grid min-w-[280px] flex-1 gap-3 md:grid-cols-2">
          <InputDevicePicker
            devices={inputDevices}
            value={settings.preferredInputDeviceId}
            onChange={(preferredInputDeviceId) => {
              void saveSettings({ preferredInputDeviceId }).then(() => replaceInputDevice(preferredInputDeviceId));
            }}
          />
          <OutputDevicePicker
            devices={outputDevices}
            value={settings.preferredOutputDeviceId}
            onChange={(preferredOutputDeviceId) => void saveSettings({ preferredOutputDeviceId })}
          />
        </div>
      </BottomControlDock>
    </PageContainer>
  );
};
