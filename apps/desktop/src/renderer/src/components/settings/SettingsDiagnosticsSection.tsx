import type {
  AppSettings,
  RendererDiagnosticsSummary,
  WindowsIntegrationStatus,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { sanitizeRuntimeServerUrl } from "../../features/diagnostics/runtimeHealthCollector";
import {
  microphoneHealth,
  roomAudioHealth,
  speakerHealth,
} from "../../features/diagnostics/healthProjection";
import {
  getAudioRuntimeSnapshot,
  getRoomRuntimeDiagnostics,
  getRoomSessionTimeline,
  injectRealtimeFault,
} from "../../hooks/useRoomState";
import { useAppStore } from "../../store/appStore";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { DiagnosticsSettingsCard } from "./DiagnosticsSettingsCard";
import { useDiagnosticsRefresh } from "./useDiagnosticsRefresh";

export const SettingsDiagnosticsSection = ({
  settings,
  windowsStatus,
  isRepairingFirewall,
  onRefreshWindows,
  onRepairFirewall,
  onOpenAudioSettings,
  onOpenAiSettings,
}: {
  settings: AppSettings;
  windowsStatus?: WindowsIntegrationStatus;
  isRepairingFirewall: boolean;
  onRefreshWindows: () => Promise<void>;
  onRepairFirewall: () => void;
  onOpenAudioSettings: () => void;
  onOpenAiSettings: () => void;
}) => {
  const navigate = useAppStore((state) => state.navigate);
  const pushToast = useAppStore((state) => state.pushToast);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const outputDeviceCount = useAudioStore((state) => state.outputDevices.length);
  const localAudioDiagnostics = useAudioStore((state) => state.localDiagnostics);
  const {
    runtimeHealth,
    relay,
    isRefreshingHealth,
    isRefreshingWindows,
    checkFeedback,
    refreshDiagnostics,
    refreshWindowsPermissions,
  } = useDiagnosticsRefresh(settings.relayServerUrl, onRefreshWindows);

  const buildRendererDiagnostics = (): RendererDiagnosticsSummary => {
    const runtime = getRoomRuntimeDiagnostics();
    const { room, connectionHealth, localStream, remoteStreams } = useRoomStore.getState();
    return {
      roomLifecycleState: room.lifecycleState,
      roomConnectionState: room.connectionState,
      serverUrl: sanitizeRuntimeServerUrl(room.signalingUrl ?? settings.relayServerUrl),
      currentRoomId: room.roomId,
      currentPeerId: runtime?.currentPeerId,
      reconnectAttempts: runtime?.reconnectAttempts ?? 0,
      connectionGeneration: runtime?.connectionGeneration,
      reconnectEpisodeId: runtime?.reconnectEpisodeId,
      reconnectEpisodeActive: runtime?.reconnectEpisodeActive,
      reconnectStableSince: runtime?.reconnectStableSince,
      lastSocketCloseCode: runtime?.lastSocketCloseCode,
      lastSocketCloseReason: runtime?.lastSocketCloseReason,
      lastSocketClosedAt: runtime?.lastSocketClosedAt,
      activeClientExists: Boolean(runtime),
      audioRelayState: runtime?.audioRelayState ?? "inactive",
      localStreamActive: Boolean(
        localStream?.getAudioTracks().some((track) => track.readyState === "live"),
      ),
      remotePeerCount: runtime?.remotePeerCount ?? Object.keys(remoteStreams).length,
      webrtcReadyPeerCount: runtime?.webrtcReadyPeerCount,
      turnConfigured: runtime?.turnConfigured,
      peerRecoveryAttempts: runtime?.peerRecoveryAttempts,
      peerConnectionStats: runtime?.peerConnectionStats,
      peerHealth: runtime?.peerHealth,
      longSessionAudio: runtime?.longSessionAudio,
      roomSnapshotRevision: runtime?.roomSnapshotRevision ?? 0,
      chatSendFailures: runtime?.chatSendFailures ?? 0,
      joinStage: runtime?.joinStage,
      wsOpened: runtime?.wsOpened,
      joinChannelSent: runtime?.joinChannelSent,
      joinAckReceived: runtime?.joinAckReceived,
      roomSnapshotReceived: runtime?.roomSnapshotReceived,
      lastServerError: runtime?.lastServerError,
      serverClockOffsetMs: runtime?.audioRelayDiagnostics?.serverClockOffsetMs,
      audioStreamEpoch: runtime?.audioRelayDiagnostics?.audioStreamEpoch,
      droppedExpiredChunks: runtime?.audioRelayDiagnostics?.droppedExpiredChunks,
      droppedSendChunks: runtime?.audioRelayDiagnostics?.droppedSendChunks,
      perPeerAudioStatus: runtime?.audioRelayDiagnostics?.perPeerAudioStatus,
      connectionHealth,
      localAudioDiagnostics,
      relayStatus: relay
        ? { ...relay, serverUrl: sanitizeRuntimeServerUrl(relay.serverUrl) }
        : undefined,
      screenShareRelayState: runtime?.screenShareRelayState,
      screenShare: runtime?.screenShare,
      audioTimeline: runtime?.audioRelayDiagnostics?.audioTimeline,
      roomSessionTimeline: getRoomSessionTimeline(),
      audioRuntime: getAudioRuntimeSnapshot(),
    };
  };

  const handleExportBundle = () => {
    void window.desktopApi.diagnostics
      .exportBundle(buildRendererDiagnostics())
      .then(() =>
        pushToast({ tone: "success", title: "诊断包已导出", description: "已保存到诊断目录。" }),
      )
      .catch(() => pushToast({ tone: "danger", title: "导出失败", description: "请稍后再试。" }));
  };

  const handleCopyDiagnostics = () => {
    const runtime = getRoomRuntimeDiagnostics();
    const microphone = microphoneHealth(getAudioRuntimeSnapshot(), localAudioDiagnostics);
    const speaker = speakerHealth({
      outputDeviceCount,
      roomActive: Boolean(runtime),
      remotePeerCount: runtime?.remotePeerCount ?? 0,
      mixer: runtime?.remoteAudioMixer,
    });
    const roomConnection = roomAudioHealth({
      remotePeerCount: runtime?.remotePeerCount ?? 0,
      webrtcReadyPeerCount: runtime?.webrtcReadyPeerCount ?? 0,
      peerHealth: runtime?.peerHealth,
    });
    const summary = [
      "上号诊断摘要",
      `麦克风：${microphone.level}；${microphone.description}`,
      `扬声器：${speaker.level}；${speaker.description}`,
      `房间连接：${roomConnection.level}；${roomConnection.description}`,
      `服务器连接：${relay ? (relay.isReachable ? "正常" : "暂时无法连接") : "尚未检测"}`,
      `网络权限：${windowsStatus ? (windowsStatus.firewall.healthy ? "正常" : "可能影响语音连接") : "尚未检测"}`,
    ].join("\n");
    void window.desktopApi.clipboard
      .writeText(summary)
      .then(() => pushToast({ tone: "success", title: "诊断摘要已复制" }))
      .catch(() => pushToast({ tone: "danger", title: "复制失败", description: "请重试。" }));
  };

  const runtime = getRoomRuntimeDiagnostics();
  return (
    <div className="space-y-4">
      <DiagnosticsSettingsCard
        runtimeHealth={runtimeHealth}
        relay={relay}
        localAudioDiagnostics={localAudioDiagnostics}
        audioRuntime={getAudioRuntimeSnapshot()}
        mixer={runtime?.remoteAudioMixer}
        peerHealth={runtime?.peerHealth}
        roomActive={Boolean(runtime)}
        outputDeviceCount={outputDeviceCount}
        webrtcReadyPeerCount={runtime?.webrtcReadyPeerCount ?? 0}
        remotePeerCount={runtime?.remotePeerCount ?? 0}
        screenShare={runtime?.screenShare}
        windowsStatus={windowsStatus}
        onOpenLogs={() => void window.desktopApi.diagnostics.openLogsDirectory()}
        onExportBundle={handleExportBundle}
        onCopySummary={handleCopyDiagnostics}
        onOpenAudioSettings={onOpenAudioSettings}
        onOpenAiSettings={onOpenAiSettings}
        onOpenHome={() => navigate("home")}
        onOpenRoom={() => navigate("room")}
        onRefreshHealth={refreshDiagnostics}
        onRefreshWindows={refreshWindowsPermissions}
        isRefreshingHealth={isRefreshingHealth}
        isRefreshingWindows={isRefreshingWindows}
        checkFeedback={checkFeedback}
        onRepairFirewall={onRepairFirewall}
        isRepairingFirewall={isRepairingFirewall}
        onInjectFault={(kind) =>
          void injectRealtimeFault({ kind })
            .then(() =>
              pushToast({
                tone: "success",
                title: "故障已注入",
                description: `Fault Lab：${kind}`,
              }),
            )
            .catch(() =>
              pushToast({
                tone: "danger",
                title: "故障注入失败",
                description: "测试命令没有执行，详细原因已写入诊断日志。",
              }),
            )
        }
      />
      <section className="settings-reset-section">
        <div>
          <strong>高级操作</strong>
          <p>安全重置仅恢复应用设置，不删除聊天、录音、模型和转录数据。</p>
        </div>
        <Button
          variant="danger"
          onClick={() => {
            if (
              !window.confirm(
                "确认重置应用设置？此操作会恢复偏好和快捷键；聊天、录音、模型及转录数据不会删除。",
              )
            )
              return;
            void resetSettings()
              .then(refreshDiagnostics)
              .then(() => pushToast({ tone: "success", title: "设置已重置" }))
              .catch((error: unknown) =>
                pushToast({
                  tone: "danger",
                  title: "设置重置失败",
                  description: error instanceof Error ? error.message : String(error),
                }),
              );
          }}
        >
          安全重置
        </Button>
      </section>
    </div>
  );
};
