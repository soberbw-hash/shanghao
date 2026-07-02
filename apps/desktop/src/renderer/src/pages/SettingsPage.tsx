import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, Bell, Headphones, MonitorCog, RefreshCw } from "lucide-react";
import { gsap } from "gsap";

import type { AppSettings, DiagnosticsSnapshot, RendererDiagnosticsSummary } from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { Switch } from "../components/base/Switch";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
import { PageContainer } from "../components/layout/PageContainer";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";
import { DiagnosticsSettingsCard } from "../components/settings/DiagnosticsSettingsCard";
import { SettingsItemRow } from "../components/settings/SettingsItemRow";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { SettingsSection } from "../components/settings/SettingsSection";
import { ShortcutSettingsCard } from "../components/settings/ShortcutSettingsCard";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useMicTest } from "../hooks/useMicTest";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { getRoomRuntimeDiagnostics } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

type SettingsSectionId = "general" | "audio" | "notifications" | "updates" | "diagnostics";

const sections = [
  { id: "general", label: "通用", icon: MonitorCog },
  { id: "audio", label: "语音", icon: Headphones },
  { id: "notifications", label: "通知", icon: Bell },
  { id: "updates", label: "更新", icon: RefreshCw },
  { id: "diagnostics", label: "诊断", icon: Activity },
  ] satisfies Array<{ id: SettingsSectionId; label: string; icon: typeof Headphones }>;

export const SettingsPage = () => {
  const navigate = useAppStore((state) => state.navigate);
  const settingsReturnTo = useAppStore((state) => state.settingsReturnTo);
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const checkUpdates = useSettingsStore((state) => state.checkUpdates);
  const openReleases = useSettingsStore((state) => state.openReleases);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const room = useRoomStore((state) => state.room);
  const localStream = useRoomStore((state) => state.localStream);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("audio");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");
  const pageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion(settings?.reduceMotion ?? false);

  const micTest = useMicTest({
    inputDeviceId: settings?.preferredInputDeviceId,
    outputDeviceId: settings?.preferredOutputDeviceId,
    echoCancellation: settings?.isEchoCancellationEnabled,
    noiseSuppression: settings?.isNoiseSuppressionEnabled,
    autoGainControl: settings?.isAutoGainControlEnabled,
    preferredSampleRate: settings?.preferredSampleRate,
    monitorMode: settings?.micMonitorMode,
    equalizerGains: settings?.micEqualizerGains,
    isLowCutEnabled: settings?.isLowCutEnabled,
  });

  useEffect(() => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  }, []);

  useLayoutEffect(() => {
    if (!settings || !pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-gsap-settings]", { clearProps: "all" });
        return;
      }

      const targets = "[data-gsap-settings='header'], [data-gsap-settings='nav'], [data-gsap-settings='content']";
      gsap.set(targets, { willChange: "transform,opacity" });
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 12 },
        {
          autoAlpha: 1,
          y: 0,
          duration: motionDuration.panel,
          ease: motionEase.spatial,
          stagger: 0.04,
          force3D: true,
          onComplete: () => gsap.set(targets, { clearProps: "willChange" }),
        },
      );
    }, pageRef);

    return () => context.revert();
  }, [reduceMotion, Boolean(settings)]);

  useLayoutEffect(() => {
    if (!settings || reduceMotion || !pageRef.current) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-gsap-settings='content']",
        { autoAlpha: 0, x: 10 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.22,
          ease: motionEase.standard,
          overwrite: true,
          force3D: true,
        },
      );
    }, pageRef);

    return () => context.revert();
  }, [activeSection, reduceMotion, Boolean(settings)]);

  if (!settings) {
    return <StartupSplashPage message="正在准备设置..." />;
  }

  const refreshDiagnostics = () => void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  const handleSaveSettings = async (patch: Partial<AppSettings>) => {
    setSaveNotice("正在保存...");
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

  const handleExportBundle = () => {
    const runtime = getRoomRuntimeDiagnostics();
    const rendererState: RendererDiagnosticsSummary = {
      roomLifecycleState: room.lifecycleState,
      roomConnectionState: room.connectionState,
      serverUrl: room.signalingUrl ?? settings.relayServerUrl,
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
      pushToast({ tone: "success", title: "诊断包已导出", description: "已保存到诊断目录。" });
    }).catch(() => pushToast({ tone: "danger", title: "导出失败", description: "请稍后再试。" }));
  };

  const content: Record<SettingsSectionId, React.ReactNode> = {
    general: (
      <SettingsSection title="应用" description="控制窗口、悬浮窗与图形渲染。">
        <div className="space-y-3">
          <SettingsItemRow
            label="一句话状态"
            description="最多 32 个字，显示在你的角色状态旁。"
          >
            <input
              defaultValue={settings.customStatus}
              maxLength={32}
              placeholder="例如：排位中，晚点聊"
              className="settings-inline-input"
              onBlur={(event) => {
                void handleSaveSettings({ customStatus: event.target.value });
              }}
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="屏幕分享画质"
            description="服务器带宽有限时推荐“流畅”。"
          >
            <select
              value={settings.screenShareQuality}
              className="settings-inline-select"
              onChange={(event) => {
                void handleSaveSettings({
                  screenShareQuality: event.target.value as AppSettings["screenShareQuality"],
                });
              }}
            >
              <option value="smooth">流畅（720p / 15fps）</option>
              <option value="balanced">均衡（900p / 20fps）</option>
              <option value="clear">清晰（1080p / 24fps）</option>
            </select>
          </SettingsItemRow>
          <SettingsItemRow
            label="共享系统音频"
            description="Windows 分享屏幕时，同时让好友听到游戏或视频声音。"
          >
            <Switch
              isChecked={settings.isScreenShareSystemAudioEnabled}
              onChange={(isScreenShareSystemAudioEnabled) =>
                void handleSaveSettings({ isScreenShareSystemAudioEnabled })
              }
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="进入频道时显示悬浮窗"
            description="默认开启，进入频道后自动显示胶囊悬浮窗。"
          >
            <Switch
              isChecked={settings.isOverlayEnabled}
              onChange={(isOverlayEnabled) => void handleSaveSettings({ isOverlayEnabled })}
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="硬件加速"
            description="默认开启。修改后下次启动生效。"
          >
            <Switch
              isChecked={settings.isHardwareAccelerationEnabled}
              onChange={(isHardwareAccelerationEnabled) =>
                void handleSaveSettings({ isHardwareAccelerationEnabled })
              }
            />
          </SettingsItemRow>
        </div>
      </SettingsSection>
    ),
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
    notifications: (
      <SettingsSection title="通知与提示音" description="保留必要的轻提示，不打扰开黑。">
        <div className="space-y-3">
          <SettingsItemRow label="界面提示音">
            <Switch
              isChecked={settings.isUiSoundEnabled}
              onChange={(isUiSoundEnabled) => void handleSaveSettings({ isUiSoundEnabled })}
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="系统通知"
            description="全屏游戏时提醒好友上线或敲你。"
          >
            <Switch
              isChecked={settings.isSystemNotificationEnabled}
              onChange={(isSystemNotificationEnabled) =>
                void handleSaveSettings({ isSystemNotificationEnabled })
              }
            />
          </SettingsItemRow>
          <SettingsItemRow label="关闭窗口时留在后台">
            <Switch
              isChecked={settings.minimizeToTray}
              onChange={(minimizeToTray) => void handleSaveSettings({ minimizeToTray })}
            />
          </SettingsItemRow>
        </div>
      </SettingsSection>
    ),
    updates: (
      <SettingsSection title="更新" description={`当前版本 ${runtimeInfo?.version ?? "读取中..."}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-[#718096]">{updateInfo?.message ?? "还没有检查更新"}</div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void checkUpdates()}>检查更新</Button>
            <Button variant="ghost" onClick={() => void openReleases()}>查看发布页</Button>
          </div>
        </div>
      </SettingsSection>
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
  };

  return (
    <PageContainer className="overflow-y-auto">
      <div ref={pageRef} className="contents">
        <div data-gsap-settings="header">
          <SettingsPageHeader onBack={() => navigate(settingsReturnTo)} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[168px_minmax(0,1fr)]">
          <nav data-gsap-settings="nav" className="settings-nav glass-panel h-fit rounded-[22px] p-2">
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
          <div data-gsap-settings="content" className="min-w-0">
            <div className="mb-2 text-right text-xs text-[#7c8da2]" aria-live="polite">{saveNotice}</div>
            {content[activeSection]}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
