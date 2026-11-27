import { useRef, useState } from "react";
import { Download, FileText, RotateCcw } from "lucide-react";
import type { RendererDiagnosticsSummary } from "@private-voice/shared";

import { Button } from "../base/Button";
import { sanitizeRuntimeServerUrl } from "../../features/diagnostics/runtimeHealthCollector";
import {
  getAudioRuntimeSnapshot,
  getRoomRuntimeDiagnostics,
  getRoomSessionTimeline,
} from "../../hooks/useRoomState";
import { useAppStore } from "../../store/appStore";
import { useAudioStore } from "../../store/audioStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";

const buildRendererDiagnostics = (): RendererDiagnosticsSummary => {
  const runtime = getRoomRuntimeDiagnostics();
  const { room, connectionHealth, localStream, remoteStreams } = useRoomStore.getState();
  return {
    roomLifecycleState: room.lifecycleState,
    roomConnectionState: room.connectionState,
    serverUrl: sanitizeRuntimeServerUrl(
      room.signalingUrl ?? useSettingsStore.getState().settings?.relayServerUrl,
    ),
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
    localAudioDiagnostics: useAudioStore.getState().localDiagnostics,
    screenShareRelayState: runtime?.screenShareRelayState,
    screenShare: runtime?.screenShare,
    audioTimeline: runtime?.audioRelayDiagnostics?.audioTimeline,
    roomSessionTimeline: getRoomSessionTimeline(),
    audioRuntime: getAudioRuntimeSnapshot(),
  };
};

export function SettingsDiagnosticsSection() {
  const pushToast = useAppStore((state) => state.pushToast);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const running = useRef(false);
  const [pending, setPending] = useState<"export" | "reset">();

  const run = async (action: "export" | "reset") => {
    if (running.current) return;
    if (
      action === "reset" &&
      !window.confirm("确认恢复默认设置？偏好和快捷键会重置，聊天、录音、模型及转录数据会保留。")
    )
      return;
    running.current = true;
    setPending(action);
    try {
      if (action === "export") {
        await window.desktopApi.diagnostics.exportBundle(buildRendererDiagnostics());
        pushToast({ tone: "success", title: "诊断包已导出", description: "已保存到诊断目录。" });
      } else {
        await resetSettings();
        pushToast({ tone: "success", title: "设置已重置" });
      }
    } catch (error) {
      pushToast({
        tone: "danger",
        title: action === "export" ? "日志导出失败" : "设置重置失败",
        description:
          error instanceof Error && error.message === "ai_model_configuration_in_use"
            ? "AI 任务还在进行，请在任务结束后再重置。"
            : "请稍后再试。",
      });
    } finally {
      running.current = false;
      setPending(undefined);
    }
  };

  return (
    <article
      className="about-info-card about-maintenance-card"
      aria-labelledby="about-diagnostics-title"
    >
      <span className="about-info-icon about-info-icon--project">
        <FileText aria-hidden="true" />
      </span>
      <div className="about-info-copy">
        <h4 id="about-diagnostics-title">日志与重置</h4>
        <p>导出诊断日志，或恢复应用默认设置。</p>
      </div>
      <div className="about-card-actions">
        <Button variant="secondary" disabled={Boolean(pending)} onClick={() => void run("export")}>
          <Download className="size-4" aria-hidden="true" />
          {pending === "export" ? "正在导出…" : "导出日志"}
        </Button>
        <Button
          variant="ghost"
          className="about-reset-action"
          disabled={Boolean(pending)}
          onClick={() => void run("reset")}
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          {pending === "reset" ? "正在重置…" : "安全重置"}
        </Button>
      </div>
    </article>
  );
}
