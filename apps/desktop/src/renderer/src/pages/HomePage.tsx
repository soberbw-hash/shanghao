import { MicPermissionState, TailscaleState } from "@private-voice/shared";

import { DeviceHealthNotice } from "../components/audio/DeviceHealthNotice";
import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { MemberGrid } from "../components/room/MemberGrid";
import { RoomHeroCard } from "../components/room/RoomHeroCard";
import { JoinRoomEmptyState } from "../components/status/JoinRoomEmptyState";
import { NoDeviceEmptyState } from "../components/status/NoDeviceEmptyState";
import { NoMicPermissionEmptyState } from "../components/status/NoMicPermissionEmptyState";
import { TailscaleDetectionBanner } from "../components/status/TailscaleDetectionBanner";
import { TailscaleInstallGuideCard } from "../components/status/TailscaleInstallGuideCard";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { useRoomState } from "../hooks/useRoomState";

export const HomePage = () => {
  const { room, joinSignalUrl, setJoinSignalUrl, startHost, joinRoom, replaceInputDevice } =
    useRoomState();
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isPushToTalkEnabled,
    toggleMute,
    setPushToTalkEnabled,
    permissionState,
  } = useAudioStore();
  const setMembers = useRoomStore((state) => state.setMembers);
  const hasAudioDevices = inputDevices.length > 0 && outputDevices.length > 0;

  return (
    <PageContainer>
      <TopStatusBar />
      <TailscaleDetectionBanner status={tailscaleStatus} />
      {permissionState === MicPermissionState.Denied ? (
        <DeviceHealthNotice message="麦克风权限当前被系统拦截，先到 Windows 里允许访问后才能开始语音。" />
      ) : null}
      {tailscaleStatus?.state === TailscaleState.NotInstalled ? (
        <DeviceHealthNotice message="这台电脑还没安装 Tailscale。你仍然可以看到本地地址，但异地好友建议通过 Tailscale 加入，连接会更稳定。" />
      ) : null}
      <RoomHeroCard
        roomName={room.roomName}
        joinSignalUrl={joinSignalUrl}
        onJoinSignalUrlChange={setJoinSignalUrl}
        onStartRoom={() => void startHost()}
        onJoinRoom={() => void joinRoom()}
      />
      {tailscaleStatus?.state === TailscaleState.NotInstalled ? (
        <TailscaleInstallGuideCard />
      ) : null}
      {permissionState === MicPermissionState.Denied ? <NoMicPermissionEmptyState /> : null}
      {permissionState !== MicPermissionState.Denied && !hasAudioDevices ? (
        <NoDeviceEmptyState />
      ) : null}
      {permissionState !== MicPermissionState.Denied && hasAudioDevices ? (
        <MemberGrid
          members={room.members}
          onVolumeChange={(memberId, value) =>
            setMembers(
              room.members.map((member) =>
                member.id === memberId ? { ...member, volume: value } : member,
              ),
            )
          }
        />
      ) : null}
      {!joinSignalUrl ? <JoinRoomEmptyState /> : null}
      <BottomControlDock>
        <div className="flex flex-wrap items-center gap-3">
          <MuteButton isMuted={isMuted} onClick={toggleMute} />
          <PushToTalkToggle
            isEnabled={isPushToTalkEnabled}
            onClick={() => {
              setPushToTalkEnabled(!isPushToTalkEnabled);
              void saveSettings({ isPushToTalkEnabled: !isPushToTalkEnabled });
            }}
          />
        </div>
        <div className="grid flex-1 gap-3 md:grid-cols-2">
          <InputDevicePicker
            devices={inputDevices}
            value={settings?.preferredInputDeviceId}
            onChange={(preferredInputDeviceId) => {
              void saveSettings({ preferredInputDeviceId }).then(() =>
                replaceInputDevice(preferredInputDeviceId),
              );
            }}
          />
          <OutputDevicePicker
            devices={outputDevices}
            value={settings?.preferredOutputDeviceId}
            onChange={(preferredOutputDeviceId) => void saveSettings({ preferredOutputDeviceId })}
          />
        </div>
      </BottomControlDock>
    </PageContainer>
  );
};
