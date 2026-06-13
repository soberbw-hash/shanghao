import { useEffect, useState } from "react";

import type { AppSettings, DiagnosticsSnapshot, RendererDiagnosticsSummary } from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { PageContainer } from "../components/layout/PageContainer";
import { AppearanceSettingsCard } from "../components/settings/AppearanceSettingsCard";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";
import { DiagnosticsSettingsCard } from "../components/settings/DiagnosticsSettingsCard";
import { NetworkSettingsCard } from "../components/settings/NetworkSettingsCard";
import { ProfileSettingsCard } from "../components/settings/ProfileSettingsCard";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { ShortcutSettingsCard } from "../components/settings/ShortcutSettingsCard";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useMicTest } from "../hooks/useMicTest";
import { getRoomRuntimeDiagnostics } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { useRoomStore } from "../store/roomStore";

export const SettingsPage = () => {
  const navigate = useAppStore((state) => state.navigate);
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);
  const networkSnapshot = useSettingsStore((state) => state.networkSnapshot);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const refreshTailscale = useSettingsStore((state) => state.refreshTailscale);
  const refreshNetworkSnapshot = useSettingsStore((state) => state.refreshNetworkSnapshot);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const checkUpdates = useSettingsStore((state) => state.checkUpdates);
  const openReleases = useSettingsStore((state) => state.openReleases);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");
  const room = useRoomStore((state) => state.room);
  const localStream = useRoomStore((state) => state.localStream);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);

  const micTest = useMicTest({
    inputDeviceId: settings?.preferredInputDeviceId,
    outputDeviceId: settings?.preferredOutputDeviceId,
    echoCancellation: settings?.isEchoCancellationEnabled,
    noiseSuppression: settings?.isNoiseSuppressionEnabled,
    autoGainControl: settings?.isAutoGainControlEnabled,
    preferredSampleRate: settings?.preferredSampleRate,
    monitorMode: settings?.micMonitorMode,
  });

  useEffect(() => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  }, []);

  if (!settings) {
    return <StartupSplashPage message="正在准备设置…" />;
  }

  const refreshDiagnostics = () => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  };

  const handleSaveSettings = async (patch: Partial<AppSettings>): Promise<void> => {
    setSaveNotice("正在保存…");
    try {
      await saveSettings(patch);
      setSaveNotice("已保存");
    } catch (error) {
      setSaveNotice("保存失败");
      pushToast({
        tone: "danger",
        title: "设置保存失败",
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
      throw error;
    }
  };

  const handleMicTest = () => {
    void micTest.toggle().catch((error) => {
      pushToast({
        tone: "danger",
        title: "试音失败",
        description:
          error instanceof Error ? error.message : "当前无法启动试音，请检查麦克风权限。",
      });
    });
  };

  const handleRefreshNetwork = () => {
    void Promise.all([refreshTailscale(), refreshNetworkSnapshot()]).then(refreshDiagnostics);
  };

  const handleTestRelay = async () => {
    await refreshNetworkSnapshot();
    const result = useSettingsStore.getState().networkSnapshot?.relay;
    pushToast({
      tone: result?.isReachable ? "success" : "danger",
      title: result?.isReachable ? "云中继可用" : "云中继不可用",
      description: result?.message ?? "暂时没有检测结果。",
    });
    return result;
  };

  const handleTestDirectHost = async () => {
    await refreshNetworkSnapshot();
    const result = useSettingsStore.getState().networkSnapshot?.directHost;
    pushToast({
      tone: result?.reachability === "reachable" ? "success" : "neutral",
      title: result?.reachability === "reachable" ? "公网直连可用" : "公网直连尚未确认",
      description: result?.message ?? "暂时没有检测结果。",
    });
    return result;
  };

  const handleExportBundle = () => {
    const runtimeDiagnostics = getRoomRuntimeDiagnostics();
    const rendererState: RendererDiagnosticsSummary = {
      roomLifecycleState: room.lifecycleState,
      roomConnectionState: room.connectionState,
      connectionMode: room.connectionMode,
      currentRoomId: room.roomId,
      currentPeerId: runtimeDiagnostics?.currentPeerId,
      reconnectAttempts: runtimeDiagnostics?.reconnectAttempts ?? 0,
      lastSocketCloseCode: runtimeDiagnostics?.lastSocketCloseCode,
      lastSocketCloseReason: runtimeDiagnostics?.lastSocketCloseReason,
      lastSocketClosedAt: runtimeDiagnostics?.lastSocketClosedAt,
      activeClientExists: Boolean(runtimeDiagnostics),
      audioRelayState: runtimeDiagnostics?.audioRelayState ?? "inactive",
      localStreamActive: Boolean(localStream?.getAudioTracks().some((track) => track.readyState === "live")),
      remotePeerCount: runtimeDiagnostics?.remotePeerCount ?? Object.keys(remoteStreams).length,
      roomSnapshotRevision: runtimeDiagnostics?.roomSnapshotRevision ?? 0,
      chatSendFailures: runtimeDiagnostics?.chatSendFailures ?? 0,
      serverClockOffsetMs: runtimeDiagnostics?.audioRelayDiagnostics?.serverClockOffsetMs,
      audioStreamEpoch: runtimeDiagnostics?.audioRelayDiagnostics?.audioStreamEpoch,
      droppedExpiredChunks: runtimeDiagnostics?.audioRelayDiagnostics?.droppedExpiredChunks,
      droppedSendChunks: runtimeDiagnostics?.audioRelayDiagnostics?.droppedSendChunks,
      perPeerAudioStatus: runtimeDiagnostics?.audioRelayDiagnostics?.perPeerAudioStatus,
      audioTimeline: runtimeDiagnostics?.audioRelayDiagnostics?.audioTimeline,
    };
    void window.desktopApi.diagnostics
      .exportBundle(rendererState)
      .then((snapshot) => {
        setDiagnostics(snapshot);
        pushToast({
          tone: "success",
          title: "诊断包已导出",
          description: snapshot.lastBundlePath || "请到导出位置查看。",
        });
      })
      .catch((error) => {
        pushToast({
          tone: "danger",
          title: "导出失败，请重试",
          description: error instanceof Error ? error.message : "暂时无法导出诊断包。",
        });
      });
  };

  const handleOpenLogs = () => {
    void window.desktopApi.diagnostics.openLogsDirectory();
  };

  const handleReset = () => {
    void resetSettings().then(() => {
      refreshDiagnostics();
      pushToast({
        tone: "success",
        title: "设置已重置",
        description: "如果是启动问题，现在可以重新打开软件验证。",
      });
    });
  };

  const handleCheckUpdates = () => {
    void checkUpdates().then((result) => {
      pushToast({
        tone: result.hasUpdate ? "success" : "neutral",
        title: "检查更新完成",
        description: result.message,
      });
      refreshDiagnostics();
    });
  };

  return (
    <PageContainer className="overflow-y-auto">
      <SettingsPageHeader onBack={() => navigate("home")} />
      <div className="mb-3 flex justify-end text-xs text-[#667085]" aria-live="polite">
        {saveNotice}
      </div>
      <div className="space-y-4">
        <ProfileSettingsCard
          settings={settings}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
        <AudioSettingsCard
          settings={settings}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          isMicTesting={micTest.isTesting}
          micTestLevel={micTest.level}
          onToggleMicTest={handleMicTest}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
        <ShortcutSettingsCard settings={settings} onChange={(patch) => void handleSaveSettings(patch)} />
        <NetworkSettingsCard
          settings={settings}
          tailscaleStatus={tailscaleStatus}
          networkSnapshot={networkSnapshot}
          runtimeInfo={runtimeInfo}
          updateInfo={updateInfo}
          onChange={handleSaveSettings}
          onRefresh={handleRefreshNetwork}
          onTestRelay={handleTestRelay}
          onTestDirectHost={handleTestDirectHost}
          onCheckUpdates={handleCheckUpdates}
          onOpenReleases={() => void openReleases()}
        />
        <AppearanceSettingsCard settings={settings} onChange={(patch) => void handleSaveSettings(patch)} />
        <DiagnosticsSettingsCard
          diagnostics={diagnostics}
          onOpenLogs={handleOpenLogs}
          onExportBundle={handleExportBundle}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="danger" onClick={handleReset}>
            安全重置设置
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};
