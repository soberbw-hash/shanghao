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
import { TailscaleDetectionBanner } from "../components/status/TailscaleDetectionBanner";
import { TailscaleInstallGuideCard } from "../components/status/TailscaleInstallGuideCard";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

export const HomePage = () => {
  const { room, joinSignalUrl, setJoinSignalUrl, startHost, joinRoom, replaceInputDevice } =
    useRoomState();
  const roomAction = useAppStore((state) => state.roomAction);
  const pushToast = useAppStore((state) => state.pushToast);
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
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);

  const handlePasteSignalUrl = () => {
    void navigator.clipboard
      .readText()
      .then((value) => setJoinSignalUrl(value.trim()))
      .catch(() => {
        pushToast({
          tone: "warning",
          title: "读取剪贴板失败",
          description: "你也可以手动粘贴房主发来的地址。",
        });
      });
  };

  return (
    <PageContainer className="overflow-y-auto">
      <TopStatusBar />
      <TailscaleDetectionBanner status={tailscaleStatus} />
      {permissionState === MicPermissionState.Denied ? (
        <DeviceHealthNotice message="还没有给上号麦克风权限，先去 Windows 设置里允许访问。" />
      ) : null}
      {inputDevices.length === 0 || outputDevices.length === 0 ? (
        <DeviceHealthNotice message="当前缺少输入或输出设备，先接好麦克风和扬声器。" />
      ) : null}
      <RoomHeroCard
        roomName={room.roomName}
        joinSignalUrl={joinSignalUrl}
        onJoinSignalUrlChange={setJoinSignalUrl}
        onPasteSignalUrl={handlePasteSignalUrl}
        onStartRoom={() => void startHost()}
        onJoinRoom={() => void joinRoom()}
        isStarting={roomAction === "starting"}
        isJoining={roomAction === "joining"}
      />
      {tailscaleStatus?.state === TailscaleState.NotInstalled ? <TailscaleInstallGuideCard /> : null}
      <div className="space-y-3">
        <div className="text-sm font-medium text-[#667085]">开黑位</div>
        <MemberGrid
          members={room.members}
          onVolumeChange={(memberId, value) => updateMemberVolume(memberId, value)}
        />
      </div>
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
        <div className="grid min-w-[280px] flex-1 gap-3 md:grid-cols-2">
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
