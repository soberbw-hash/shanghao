import { RecordingState, RoomConnectionState } from "@private-voice/shared";

import { ControlBar } from "../components/audio/ControlBar";
import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { NoiseSuppressionToggle } from "../components/audio/NoiseSuppressionToggle";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkKeyBadge } from "../components/audio/PushToTalkKeyBadge";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { RecordingButton } from "../components/audio/RecordingButton";
import { Button } from "../components/base/Button";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { InlineBanner } from "../components/layout/InlineBanner";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { ConnectionHealthStrip } from "../components/room/ConnectionHealthStrip";
import { MemberGrid } from "../components/room/MemberGrid";
import { RoomCodePanel } from "../components/room/RoomCodePanel";
import { RoomStatusPanel } from "../components/room/RoomStatusPanel";
import { RecordingErrorBanner } from "../components/status/RecordingErrorBanner";
import { RecordingHistoryList } from "../components/status/RecordingHistoryList";
import { RecordingStatusBanner } from "../components/status/RecordingStatusBanner";
import { useRecordingController } from "../hooks/useRecordingController";
import { useRoomState } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

export const RoomPage = () => {
  const { room, leaveRoom, replaceInputDevice } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const {
    inputDevices,
    outputDevices,
    isMuted,
    isPushToTalkEnabled,
    isNoiseSuppressionEnabled,
    toggleMute,
    setPushToTalkEnabled,
    setNoiseSuppressionEnabled,
  } = useAudioStore();
  const recordingStatus = useRecordingStore((state) => state.status);
  const recordingHistory = useRecordingStore((state) => state.history);
  const updateMemberVolume = useRoomStore((state) => state.updateMemberVolume);
  const connectionHealth = useRoomStore((state) => state.connectionHealth);
  const { startRecording, stopRecording } = useRecordingController();

  const handleRecording = async () => {
    try {
      if (recordingStatus.state === RecordingState.Recording) {
        await stopRecording();
        return;
      }

      startRecording();
    } catch (error) {
      pushToast({
        tone: "danger",
        title: "录音无法开始",
        description:
          error instanceof Error ? error.message : "当前没有可用于录音的音频来源。",
      });
    }
  };

  const isRecordingBusy =
    recordingStatus.state === RecordingState.Preparing ||
    recordingStatus.state === RecordingState.Stopping ||
    recordingStatus.state === RecordingState.Saving;

  return (
    <PageContainer className="overflow-y-auto">
      <TopStatusBar />
      {room.connectionState === RoomConnectionState.Reconnecting ? (
        <InlineBanner tone="warning">连接有波动，正在自动重连…</InlineBanner>
      ) : null}
      {room.connectionState === RoomConnectionState.Failed ? (
        <InlineBanner tone="danger">当前房间连接失败，请检查网络后重试。</InlineBanner>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <RoomStatusPanel
          roomName={room.roomName}
          memberCount={room.memberCount}
          connectionState={room.connectionState}
        />
        <RoomCodePanel signalingUrl={room.signalingUrl} />
      </div>
      <ConnectionHealthStrip
        latencyMs={connectionHealth.latencyMs}
        jitterMs={connectionHealth.jitterMs}
        packetLossPercent={connectionHealth.packetLossPercent}
      />
      <RecordingStatusBanner
        state={recordingStatus.state}
        durationMs={recordingStatus.durationMs}
        message={recordingStatus.message}
        startedAt={
          recordingStatus.state === RecordingState.Recording
            ? recordingStatus.startedAt
            : undefined
        }
      />
      <RecordingErrorBanner
        message={recordingStatus.state === RecordingState.Failed ? recordingStatus.message : undefined}
      />
      <div className="space-y-3">
        <div className="text-sm font-medium text-[#667085]">开黑位</div>
        <MemberGrid
          members={room.members}
          onVolumeChange={(memberId, value) => updateMemberVolume(memberId, value)}
        />
      </div>
      <RecordingHistoryList items={recordingHistory} />
      <BottomControlDock>
        <ControlBar>
          <MuteButton isMuted={isMuted} onClick={toggleMute} />
          <PushToTalkToggle
            isEnabled={isPushToTalkEnabled}
            onClick={() => {
              setPushToTalkEnabled(!isPushToTalkEnabled);
              void saveSettings({ isPushToTalkEnabled: !isPushToTalkEnabled });
            }}
          />
          {isPushToTalkEnabled ? (
            <PushToTalkKeyBadge shortcut={settings?.pushToTalkShortcut || "Space"} />
          ) : null}
          <NoiseSuppressionToggle
            isEnabled={isNoiseSuppressionEnabled}
            onClick={() => {
              setNoiseSuppressionEnabled(!isNoiseSuppressionEnabled);
              void saveSettings({ isNoiseSuppressionEnabled: !isNoiseSuppressionEnabled });
            }}
          />
          <RecordingButton
            isRecording={recordingStatus.state === RecordingState.Recording}
            onClick={() => void handleRecording()}
            disabled={isRecordingBusy}
          />
        </ControlBar>
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
        <Button variant="danger" onClick={() => void leaveRoom()}>
          离开房间
        </Button>
      </BottomControlDock>
    </PageContainer>
  );
};
