import { useEffect, useState } from "react";

import type {
  AppSettings,
  RelayStatusSnapshot,
  RendererDiagnosticsSummary,
  RuntimeHealthSnapshot,
  WindowsIntegrationStatus,
} from "@private-voice/shared";

import { Button } from "../base/Button";
import { rendererPerformanceMonitor } from "../../features/diagnostics/rendererPerformanceMonitor";
import { getRoomRuntimeDiagnostics, injectRealtimeFault } from "../../hooks/useRoomState";
import { useAppStore } from "../../store/appStore";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { DiagnosticsSettingsCard } from "./DiagnosticsSettingsCard";

const sanitizeServerUrl = (value?: string): string | undefined => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "地址格式不可识别";
  }
};

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
  onRefreshWindows: () => void;
  onRepairFirewall: () => void;
  onOpenAudioSettings: () => void;
  onOpenAiSettings: () => void;
}) => {
  const navigate = useAppStore((state) => state.navigate);
  const pushToast = useAppStore((state) => state.pushToast);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const outputDeviceCount = useAudioStore((state) => state.outputDevices.length);
  const localAudioDiagnostics = useAudioStore((state) => state.localDiagnostics);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthSnapshot>();
  const [relay, setRelay] = useState<RelayStatusSnapshot>();

  useEffect(() => {
    if (!settings.relayServerUrl) return;
    let cancelled = false;
    void window.desktopApi.diagnostics
      .testServer(settings.relayServerUrl)
      .then((snapshot) => {
        if (!cancelled) setRelay(snapshot);
      })
      .catch(() => {
        if (!cancelled) setRelay(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.relayServerUrl]);

  useEffect(() => {
    let cancelled = false;
    const stopPerformanceMonitor = rendererPerformanceMonitor.start();
    const refresh = async () => {
      const runtime = getRoomRuntimeDiagnostics();
      const { room, localStream, remoteStreams } = useRoomStore.getState();
      const memory = performance as Performance & {
        memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number };
      };
      const trackCount = [localStream, ...Object.values(remoteStreams)].reduce(
        (total, stream) => total + (stream?.getTracks().length ?? 0),
        0,
      );
      const mixerHealth = runtime?.remoteAudioMixer;
      const snapshot = await window.desktopApi.diagnostics.runtimeHealth({
        performance: rendererPerformanceMonitor.snapshot(),
        jsHeapUsedBytes: memory.memory?.usedJSHeapSize,
        jsHeapTotalBytes: memory.memory?.totalJSHeapSize,
        domNodeCount: document.getElementsByTagName("*").length,
        trackCount,
        audioNodeCount: mixerHealth?.audioNodeCount,
        audioContextCount: mixerHealth?.audioContextCount,
        timerCount: mixerHealth?.timerCount,
        screenShare: runtime?.screenShare
          ? {
              active: Boolean(
                runtime.screenShare.requested ||
                Object.keys(runtime.screenShare.receive).length ||
                runtime.screenShare.fallback.active,
              ),
              fallbackActive: runtime.screenShare.fallback.active,
              requestedWidth: runtime.screenShare.requested?.width,
              requestedHeight: runtime.screenShare.requested?.height,
              captureWidth: runtime.screenShare.capture?.width,
              captureHeight: runtime.screenShare.capture?.height,
              captureFps: runtime.screenShare.capture?.framesPerSecond,
            }
          : undefined,
        room: {
          roomLifecycleState: room.lifecycleState,
          roomConnectionState: room.connectionState,
          serverUrl: sanitizeServerUrl(room.signalingUrl ?? settings.relayServerUrl),
          currentRoomId: room.roomId,
          currentPeerId: runtime?.currentPeerId,
          reconnectAttempts: runtime?.reconnectAttempts ?? 0,
          connectionGeneration: runtime?.connectionGeneration,
          reconnectEpisodeId: runtime?.reconnectEpisodeId,
          reconnectEpisodeActive: runtime?.reconnectEpisodeActive,
          reconnectStableSince: runtime?.reconnectStableSince,
          activeClientExists: Boolean(runtime),
          audioRelayState: runtime?.audioRelayState ?? "inactive",
          localStreamActive: Boolean(
            localStream?.getAudioTracks().some((track) => track.readyState === "live"),
          ),
          remotePeerCount: runtime?.remotePeerCount ?? Object.keys(remoteStreams).length,
          screenShareRelayState: runtime?.screenShareRelayState,
          roomSnapshotRevision: runtime?.roomSnapshotRevision ?? 0,
          chatSendFailures: runtime?.chatSendFailures ?? 0,
        },
      });
      if (!cancelled) setRuntimeHealth(snapshot);
    };

    void refresh().catch(() => undefined);
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stopPerformanceMonitor();
    };
  }, [settings.relayServerUrl]);

  const refreshDiagnostics = () => {
    if (settings.relayServerUrl) {
      void window.desktopApi.diagnostics
        .testServer(settings.relayServerUrl)
        .then(setRelay)
        .catch(() => setRelay(undefined));
    }
    onRefreshWindows();
  };

  const buildRendererDiagnostics = (): RendererDiagnosticsSummary => {
    const runtime = getRoomRuntimeDiagnostics();
    const { room, connectionHealth, localStream, remoteStreams } = useRoomStore.getState();
    return {
      roomLifecycleState: room.lifecycleState,
      roomConnectionState: room.connectionState,
      serverUrl: sanitizeServerUrl(room.signalingUrl ?? settings.relayServerUrl),
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
      relayStatus: relay ? { ...relay, serverUrl: sanitizeServerUrl(relay.serverUrl) } : undefined,
      screenShareRelayState: runtime?.screenShareRelayState,
      screenShare: runtime?.screenShare,
      audioTimeline: runtime?.audioRelayDiagnostics?.audioTimeline,
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
    const microphone = localAudioDiagnostics
      ? localAudioDiagnostics.inputOverload === "warning"
        ? "输入音量偏高，建议检查"
        : "正常"
      : "尚未检测";
    const roomConnection =
      (runtime?.remotePeerCount ?? 0) === 0
        ? "尚未检测"
        : (runtime?.webrtcReadyPeerCount ?? 0) === runtime?.remotePeerCount
          ? "正常"
          : "有好友连接不稳定";
    const summary = [
      "上号诊断摘要",
      `麦克风：${microphone}`,
      `扬声器：${outputDeviceCount > 0 ? "正常" : "没有检测到输出设备"}`,
      `房间连接：${roomConnection}`,
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
        onRefreshWindows={onRefreshWindows}
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
      <Button variant="danger" onClick={() => void resetSettings().then(refreshDiagnostics)}>
        安全重置设置
      </Button>
    </div>
  );
};
