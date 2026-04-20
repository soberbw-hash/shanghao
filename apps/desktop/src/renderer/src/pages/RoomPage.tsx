import { useMemo, useState } from "react";

import {
  RecordingState,
  RoomConnectionState,
  type ConnectionMode,
} from "@private-voice/shared";

import { ControlBar } from "../components/audio/ControlBar";
import { InputDevicePicker } from "../components/audio/InputDevicePicker";
import { MuteButton } from "../components/audio/MuteButton";
import { NoiseSuppressionToggle } from "../components/audio/NoiseSuppressionToggle";
import { OutputDevicePicker } from "../components/audio/OutputDevicePicker";
import { PushToTalkKeyBadge } from "../components/audio/PushToTalkKeyBadge";
import { PushToTalkToggle } from "../components/audio/PushToTalkToggle";
import { RecordingButton } from "../components/audio/RecordingButton";
import { TemporaryChatPanel } from "../components/chat/TemporaryChatPanel";
import { Button } from "../components/base/Button";
import { BottomControlDock } from "../components/layout/BottomControlDock";
import { InlineBanner } from "../components/layout/InlineBanner";
import { PageContainer } from "../components/layout/PageContainer";
import { TopStatusBar } from "../components/layout/TopStatusBar";
import { ConnectionHealthStrip } from "../components/room/ConnectionHealthStrip";
import { MemberGrid } from "../components/room/MemberGrid";
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

const modeLabels: Record<ConnectionMode, string> = {
  direct_host: "房主直连",
  tailscale: "Tailscale",
  relay: "云中继",
};

const getRoomStatusSummary = ({
  connectionMode,
  signalingUrl,
  hostSession,
  latestHostEvent,
  latestFailureReason,
}: {
  connectionMode: ConnectionMode;
  signalingUrl?: string;
  hostSession?: ReturnType<typeof useRoomStore.getState>["hostSession"];
  latestHostEvent?: string;
  latestFailureReason?: string;
}) => {
  if (latestFailureReason) {
    return {
      title: "连接失败",
      description: latestFailureReason,
      tone: "danger" as const,
    };
  }

  if (latestHostEvent) {
    return {
      title: "房主状态",
      description: latestHostEvent,
      tone: "neutral" as const,
    };
  }

  if (connectionMode === "direct_host") {
    const probe = hostSession?.directHostProbe;
    if (probe?.reachability === "reachable" && signalingUrl) {
      return {
        title: "公网直连可用",
        description: "房间已启动，公网地址已验证可达，可以直接分享给好友。",
        tone: "success" as const,
      };
    }

    if (probe?.reachability === "unverified" && signalingUrl) {
      return {
        title: "候选地址已生成",
        description: probe.message,
        tone: "warning" as const,
      };
    }

    if (probe?.reachability === "pending") {
      return {
        title: "正在检测地址",
        description: probe.message,
        tone: "neutral" as const,
      };
    }

    if (hostSession?.hostState === "active") {
      return {
        title: "房间已启动",
        description: probe?.message || "当前网络不支持公网直连，建议切换 Tailscale 或云中继。",
        tone: "warning" as const,
      };
    }
  }

  if (connectionMode === "tailscale") {
    return {
      title: signalingUrl ? "地址已准备好" : "房间已启动",
      description: signalingUrl
        ? "Tailscale 地址已经准备好，固定好友可直接加入。"
        : "正在准备 Tailscale 邀请地址。",
      tone: signalingUrl ? ("success" as const) : ("neutral" as const),
    };
  }

  return {
    title: signalingUrl ? "中继已就绪" : "正在准备中继",
    description: signalingUrl
      ? "云中继地址已经就绪，可以复制给好友。"
      : "房间已启动，正在准备云中继邀请地址。",
    tone: signalingUrl ? ("success" as const) : ("neutral" as const),
  };
};

export const RoomPage = () => {
  const { room, leaveRoom, replaceInputDevice, copyInviteLink, sendChatMessage } = useRoomState();
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const hostSession = useRoomStore((state) => state.hostSession);
  const chatMessages = useRoomStore((state) => state.chatMessages);
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
  const [chatInput, setChatInput] = useState("");

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
          error instanceof Error ? error.message : "当前没有可用的录音音频来源。",
      });
    }
  };

  const handleSendChat = () => {
    const content = chatInput.trim();
    if (!content) {
      return;
    }

    void sendChatMessage(content).then(() => {
      setChatInput("");
    });
  };

  const isRecordingBusy =
    recordingStatus.state === RecordingState.Preparing ||
    recordingStatus.state === RecordingState.Stopping ||
    recordingStatus.state === RecordingState.Saving;

  const isWaitingForFriends =
    Boolean(hostSession) && room.connectionState === RoomConnectionState.WaitingPeer;

  const roomSummary = useMemo(
    () =>
      getRoomStatusSummary({
        connectionMode: room.connectionMode,
        signalingUrl: room.signalingUrl,
        hostSession,
        latestHostEvent: room.recentHostEvents?.[0]?.message,
        latestFailureReason: room.latestFailureReason,
      }),
    [hostSession, room.connectionMode, room.latestFailureReason, room.recentHostEvents, room.signalingUrl],
  );

  const shareableAddress = hostSession?.signalingUrl || room.signalingUrl;
  const displayAddress =
    shareableAddress ||
    (room.connectionMode === "direct_host"
      ? "房间已启动，正在检测公网直连能力。"
      : "房间已启动，正在准备邀请地址。");
  const copyButtonLabel =
    room.connectionMode === "direct_host" && hostSession?.directHostProbe?.reachability === "unverified"
      ? "复制候选地址"
      : "复制地址";

  return (
    <PageContainer className="overflow-y-auto">
      <TopStatusBar />
      {isWaitingForFriends ? (
        <InlineBanner tone="neutral">等待好友加入</InlineBanner>
      ) : null}
      {room.connectionState === RoomConnectionState.Reconnecting ? (
        <InlineBanner tone="warning">连接有波动，正在自动重连…</InlineBanner>
      ) : null}
      {room.connectionState === RoomConnectionState.Failed ? (
        <InlineBanner tone="danger">
          当前连接失败。你可以直接重试，或者去设置页导出诊断包。
        </InlineBanner>
      ) : null}

      <section className="grid items-stretch gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="flex min-h-[360px] flex-col gap-4">
          <RoomStatusPanel
            roomName={room.roomName}
            memberCount={room.memberCount}
            connectionState={room.connectionState}
            hasHostSession={Boolean(hostSession)}
          />

          <div className="grid flex-1 gap-4 md:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[18px] border border-[#E7ECF2] bg-white p-4 shadow-[0_10px_26px_rgba(17,24,39,0.05)]">
              <div className="text-xs uppercase tracking-[0.2em] text-[#98A2B3]">连接方式</div>
              <div className="mt-2 text-lg font-semibold text-[#111827]">
                {modeLabels[room.connectionMode]}
              </div>
              <div className="mt-3 rounded-[14px] border border-[#E7ECF2] bg-[#F8FAFC] px-3 py-3">
                <div className="text-sm font-medium text-[#111827]">{roomSummary.title}</div>
                <div className="mt-1 text-sm text-[#667085]">{roomSummary.description}</div>
              </div>
              {hostSession?.hostAddress ? (
                <div className="mt-3 text-sm text-[#667085]">
                  当前主地址：<span className="break-all text-[#111827]">{hostSession.hostAddress}</span>
                </div>
              ) : null}
            </div>

            <div className="rounded-[18px] border border-[#E7ECF2] bg-white p-4 shadow-[0_10px_26px_rgba(17,24,39,0.05)]">
              <div className="text-xs uppercase tracking-[0.2em] text-[#98A2B3]">房间地址</div>
              <div className="mt-2 text-sm text-[#667085]">
                把这份地址发给固定好友，对方粘贴后就能加入。
              </div>
              <div className="mt-4 rounded-[14px] border border-[#E7ECF2] bg-[#F8FAFC] px-3 py-3 text-sm text-[#111827]">
                <div className="break-all">{displayAddress}</div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => void copyInviteLink()}
                  disabled={!shareableAddress}
                >
                  {copyButtonLabel}
                </Button>
                <div className="text-sm text-[#98A2B3]">
                  {shareableAddress ? "地址已就绪" : "等待地址准备完成"}
                </div>
              </div>
            </div>
          </div>
        </div>

        <TemporaryChatPanel
          className="h-full"
          messages={chatMessages}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSend={handleSendChat}
          emptyMessage="房间里还没有聊天消息。开房后更适合在这里补一句文字和 emoji。"
        />
      </section>

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
