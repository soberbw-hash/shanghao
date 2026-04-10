import { RecordingState } from "@private-voice/shared";

import { ControlBar } from "../components/audio/ControlBar";
import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { NoiseSuppressionToggle } from "../components/audio/NoiseSuppressionToggle";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkKeyBadge } from "../components/audio/PushToTalkKeyBadge";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { RecordingButton } from "../components/audio/RecordingButton";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { ConnectionHealthStrip } from "../components/room/ConnectionHealthStrip";
import { MemberGrid } from "../components/room/MemberGrid";
import { RoomCodePanel } from "../components/room/RoomCodePanel";
import { RoomStatusPanel } from "../components/room/RoomStatusPanel";
import { RecordingConsentNotice } from "../components/status/RecordingConsentNotice";
import { RecordingErrorBanner } from "../components/status/RecordingErrorBanner";
import { RecordingHistoryList } from "../components/status/RecordingHistoryList";
import { RecordingStatusBanner } from "../components/status/RecordingStatusBanner";
import { UpdateNotice } from "../components/status/UpdateNotice";
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
  const { inputDevices, outputDevices, isMuted, isPushToTalkEnabled, isNoiseSuppressionEnabled, toggleMute, setPushToTalkEnabled, setNoiseSuppressionEnabled } = useAudioStore();
  const recordingStatus = useRecordingStore((state) => state.status);
  const recordingHistory = useRecordingStore((state) => state.history);
  const setMembers = useRoomStore((state) => state.setMembers);
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
    <PageContainer>
      <TopStatusBar />
      <ConnectionHealthStrip
        latencyMs={connectionHealth.latencyMs}
        jitterMs={connectionHealth.jitterMs}
        packetLossPercent={connectionHealth.packetLossPercent}
      />
      <RoomStatusPanel
        roomName={room.roomName}
        memberCount={room.memberCount}
        connectionState={room.connectionState}
      />
      <RoomCodePanel signalingUrl={room.signalingUrl} />
      <RecordingConsentNotice />
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
      <RecordingErrorBanner message={recordingStatus.state === RecordingState.Failed ? recordingStatus.message : undefined} />
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
      <RecordingHistoryList items={recordingHistory} />
      <UpdateNotice />
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
          <PushToTalkKeyBadge shortcut={settings?.pushToTalkShortcut || "Space"} />
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
        <button
          type="button"
          onClick={() => void leaveRoom()}
          className="rounded-[14px] border border-rose-300/20 bg-rose-300/8 px-4 py-3 text-sm font-medium text-rose-100"
        >
          离开房间
        </button>
      </BottomControlDock>
    </PageContainer>
  );
};
