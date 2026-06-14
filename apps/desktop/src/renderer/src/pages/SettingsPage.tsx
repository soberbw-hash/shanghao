import { useEffect, useState } from "react";
import {
  Activity,
  Bell,
  CircleUserRound,
  Headphones,
  Network,
  PanelTopOpen,
} from "lucide-react";

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
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

type SettingsSectionId = "profile" | "audio" | "floating" | "notifications" | "network" | "diagnostics";

const sections = [
  { id: "profile", label: "资料", icon: CircleUserRound },
  { id: "audio", label: "语音", icon: Headphones },
  { id: "floating", label: "悬浮小窗", icon: PanelTopOpen },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "network", label: "高级连接", icon: Network },
  { id: "diagnostics", label: "诊断", icon: Activity },
] satisfies Array<{ id: SettingsSectionId; label: string; icon: typeof CircleUserRound }>;

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
  const room = useRoomStore((state) => state.room);
  const localStream = useRoomStore((state) => state.localStream);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("profile");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");

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

  const refreshDiagnostics = () => void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    setSaveNotice("正在保存…");
    try {
      await saveSettings(patch);
      setSaveNotice("已保存");
    } catch (error) {
      setSaveNotice("保存失败");
      pushToast({ tone: "danger", title: "设置保存失败", description: error instanceof Error ? error.message : "请稍后重试。" });
      throw error;
    }
  };
  const handleRefreshNetwork = () => void Promise.all([refreshTailscale(), refreshNetworkSnapshot()]).then(refreshDiagnostics);
  const handleTestRelay = async () => {
    await refreshNetworkSnapshot();
    return useSettingsStore.getState().networkSnapshot?.relay;
  };
  const handleTestDirectHost = async () => {
    await refreshNetworkSnapshot();
    return useSettingsStore.getState().networkSnapshot?.directHost;
  };
  const handleExportBundle = () => {
    const runtime = getRoomRuntimeDiagnostics();
    const rendererState: RendererDiagnosticsSummary = {
      roomLifecycleState: room.lifecycleState,
      roomConnectionState: room.connectionState,
      connectionMode: room.connectionMode,
      currentRoomId: room.roomId,
      currentPeerId: runtime?.currentPeerId,
      reconnectAttempts: runtime?.reconnectAttempts ?? 0,
      lastSocketCloseCode: runtime?.lastSocketCloseCode,
      lastSocketCloseReason: runtime?.lastSocketCloseReason,
      lastSocketClosedAt: runtime?.lastSocketClosedAt,
      activeClientExists: Boolean(runtime),
      audioRelayState: runtime?.audioRelayState ?? "inactive",
      localStreamActive: Boolean(localStream?.getAudioTracks().some((track) => track.readyState === "live")),
      remotePeerCount: runtime?.remotePeerCount ?? Object.keys(remoteStreams).length,
      roomSnapshotRevision: runtime?.roomSnapshotRevision ?? 0,
      chatSendFailures: runtime?.chatSendFailures ?? 0,
      serverClockOffsetMs: runtime?.audioRelayDiagnostics?.serverClockOffsetMs,
      audioStreamEpoch: runtime?.audioRelayDiagnostics?.audioStreamEpoch,
      droppedExpiredChunks: runtime?.audioRelayDiagnostics?.droppedExpiredChunks,
      droppedSendChunks: runtime?.audioRelayDiagnostics?.droppedSendChunks,
      perPeerAudioStatus: runtime?.audioRelayDiagnostics?.perPeerAudioStatus,
      audioTimeline: runtime?.audioRelayDiagnostics?.audioTimeline,
    };
    void window.desktopApi.diagnostics.exportBundle(rendererState).then((snapshot) => {
      setDiagnostics(snapshot);
      pushToast({ tone: "success", title: "诊断包已导出", description: snapshot.lastBundlePath || "请到导出位置查看。" });
    }).catch(() => pushToast({ tone: "danger", title: "导出失败", description: "请稍后再试。" }));
  };

  const content = {
    profile: <ProfileSettingsCard settings={settings} onChange={(patch) => void handleSaveSettings(patch)} />,
    audio: (
      <div className="space-y-4">
        <AudioSettingsCard
          settings={settings}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          isMicTesting={micTest.isTesting}
          micTestLevel={micTest.level}
          onToggleMicTest={() => void micTest.toggle()}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
        <ShortcutSettingsCard settings={settings} onChange={(patch) => void handleSaveSettings(patch)} />
      </div>
    ),
    floating: <AppearanceSettingsCard section="floating" settings={settings} onChange={(patch) => void handleSaveSettings(patch)} />,
    notifications: <AppearanceSettingsCard section="notifications" settings={settings} onChange={(patch) => void handleSaveSettings(patch)} />,
    network: (
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
        onCheckUpdates={() => void checkUpdates()}
        onOpenReleases={() => void openReleases()}
      />
    ),
    diagnostics: (
      <div className="space-y-4">
        <DiagnosticsSettingsCard
          diagnostics={diagnostics}
          onOpenLogs={() => void window.desktopApi.diagnostics.openLogsDirectory()}
          onExportBundle={handleExportBundle}
        />
        <Button variant="danger" onClick={() => void resetSettings().then(refreshDiagnostics)}>安全重置设置</Button>
      </div>
    ),
  } satisfies Record<SettingsSectionId, React.ReactNode>;

  return (
    <PageContainer className="overflow-y-auto">
      <SettingsPageHeader onBack={() => navigate("home")} />
      <div className="mt-5 grid gap-5 lg:grid-cols-[176px_minmax(0,1fr)]">
        <nav className="settings-nav glass-panel h-fit rounded-[22px] p-2">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={`flex w-full items-center gap-3 whitespace-nowrap rounded-[14px] px-3 py-2.5 text-left text-sm font-semibold transition ${
                activeSection === id ? "bg-[#eaf1ff] text-[#3f6ed7]" : "text-[#718096] hover:bg-white/70"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="mb-2 text-right text-xs text-[#7c8da2]" aria-live="polite">{saveNotice}</div>
          {content[activeSection]}
        </div>
      </div>
    </PageContainer>
  );
};
