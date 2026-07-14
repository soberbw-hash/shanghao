import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Activity, Bell, Headphones, MonitorCog, RefreshCw } from "lucide-react";
import { gsap } from "gsap";

import type {
  AppSettings,
  DiagnosticsSnapshot,
  RelayStatusSnapshot,
  RendererDiagnosticsSummary,
} from "@private-voice/shared";

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

const sanitizeDiagnosticsServerUrl = (value?: string): string | undefined => {
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
  const localAudioDiagnostics = useAudioStore((state) => state.localDiagnostics);
  const room = useRoomStore((state) => state.room);
  const connectionHealth = useRoomStore((state) => state.connectionHealth);
  const localStream = useRoomStore((state) => state.localStream);
  const remoteStreams = useRoomStore((state) => state.remoteStreams);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("audio");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [relayDiagnostics, setRelayDiagnostics] = useState<RelayStatusSnapshot>();
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");
  const pageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const isSettingsReady = Boolean(settings);

  const micTest = useMicTest({
    inputDeviceId: settings?.preferredInputDeviceId,
    outputDeviceId: settings?.preferredOutputDeviceId,
    echoCancellation: settings?.isEchoCancellationEnabled,
    noiseSuppression: settings?.isNoiseSuppressionEnabled,
    autoGainControl: settings?.isAutoGainControlEnabled,
    preferredSampleRate: settings?.preferredSampleRate,
    monitorMode: settings?.micMonitorMode,
    equalizerGains: settings?.micEqualizerGains,
    lowCutFrequency: settings?.lowCutFrequency,
  });

  useEffect(() => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  }, []);

  useEffect(() => {
    if (activeSection !== "diagnostics" || !settings?.relayServerUrl) return;
    let cancelled = false;
    void window.desktopApi.diagnostics
      .testServer(settings.relayServerUrl)
      .then((snapshot) => {
        if (!cancelled) setRelayDiagnostics(snapshot);
      })
      .catch(() => {
        if (!cancelled) setRelayDiagnostics(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSection, settings?.relayServerUrl]);

  useLayoutEffect(() => {
    if (!isSettingsReady || !pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) {
        gsap.set("[data-gsap-settings]", { clearProps: "all" });
        return;
      }

      const targets =
        "[data-gsap-settings='header'], [data-gsap-settings='nav'], [data-gsap-settings='content']";
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
  }, [isSettingsReady, reduceMotion]);

  useLayoutEffect(() => {
    if (!isSettingsReady || reduceMotion || !pageRef.current) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-gsap-settings='content']",
        { autoAlpha: 0, x: 10 },
        {
          autoAlpha: 1,
          x: 0,
          duration: motionDuration.message,
          ease: motionEase.spatial,
          overwrite: true,
          force3D: true,
        },
      );
    }, pageRef);

    return () => context.revert();
  }, [activeSection, isSettingsReady, reduceMotion]);

  if (!settings) {
    return <StartupSplashPage message="正在准备设置..." />;
  }

  const refreshDiagnostics = () =>
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
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

  const buildRendererDiagnostics = (): RendererDiagnosticsSummary => {
    const runtime = getRoomRuntimeDiagnostics();
    return {
      roomLifecycleState: room.lifecycleState,
      roomConnectionState: room.connectionState,
      serverUrl: sanitizeDiagnosticsServerUrl(room.signalingUrl ?? settings.relayServerUrl),
      currentRoomId: room.roomId,
      currentPeerId: runtime?.currentPeerId,
      reconnectAttempts: runtime?.reconnectAttempts ?? 0,
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
      relayStatus: relayDiagnostics
        ? {
            ...relayDiagnostics,
            serverUrl: sanitizeDiagnosticsServerUrl(relayDiagnostics.serverUrl),
          }
        : undefined,
      screenShareRelayState: runtime?.screenShareRelayState,
      audioTimeline: runtime?.audioRelayDiagnostics?.audioTimeline,
    };
  };

  const handleExportBundle = () => {
    const rendererState = buildRendererDiagnostics();
    void window.desktopApi.diagnostics
      .exportBundle(rendererState)
      .then((snapshot) => {
        setDiagnostics(snapshot);
        pushToast({ tone: "success", title: "诊断包已导出", description: "已保存到诊断目录。" });
      })
      .catch(() => pushToast({ tone: "danger", title: "导出失败", description: "请稍后再试。" }));
  };

  const handleCopyDiagnostics = () => {
    const runtime = getRoomRuntimeDiagnostics();
    const relayFallbackActive = Boolean(
      runtime?.audioRelayDiagnostics?.perPeerAudioStatus.some(
        (status) => status.fallbackStatus === "relay_active",
      ),
    );
    const summary = [
      `服务器：${sanitizeDiagnosticsServerUrl(settings.relayServerUrl) ?? "未配置"}`,
      `Relay：${relayDiagnostics?.isReachable ? `${relayDiagnostics.latencyMs ?? "--"} ms` : "不可达"}`,
      `TURN：${relayDiagnostics?.turnConfigured || runtime?.turnConfigured ? "已配置" : "未配置"}`,
      `WebRTC：${runtime?.webrtcReadyPeerCount ?? 0}/${runtime?.remotePeerCount ?? 0}`,
      `语音路径：${relayFallbackActive ? "信令音频兜底" : (connectionHealth.voicePath ?? "unknown")}`,
      `丢包：${connectionHealth.packetLossPercent.toFixed(1)}%`,
      `抖动：${Math.round(connectionHealth.jitterMs)} ms`,
      `降噪：${localAudioDiagnostics?.noiseProcessor ?? "unknown"}`,
    ].join("\n");
    void window.desktopApi.clipboard
      .writeText(summary)
      .then(() => pushToast({ tone: "success", title: "诊断摘要已复制" }))
      .catch(() => pushToast({ tone: "danger", title: "复制失败", description: "请重试。" }));
  };

  const runtimeDiagnostics = getRoomRuntimeDiagnostics();
  const isAudioRelayActive = Boolean(
    runtimeDiagnostics?.audioRelayDiagnostics?.perPeerAudioStatus.some(
      (status) => status.fallbackStatus === "relay_active",
    ),
  );

  const content: Record<SettingsSectionId, React.ReactNode> = {
    general: (
      <SettingsSection title="应用" description="控制窗口、悬浮窗与图形渲染。">
        <div className="space-y-3">
          <SettingsItemRow label="屏幕分享画质" description="服务器带宽有限时推荐“流畅”。">
            <select
              value={settings.screenShareQuality}
              className="settings-inline-select"
              onChange={(event) => {
                void handleSaveSettings({
                  screenShareQuality: event.target.value as AppSettings["screenShareQuality"],
                });
              }}
            >
              <option value="720p">720p（流畅，推荐）</option>
              <option value="1080p">1080p（清晰）</option>
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
          <SettingsItemRow label="硬件加速" description="默认开启。修改后下次启动生效。">
            <Switch
              isChecked={settings.isHardwareAccelerationEnabled}
              onChange={(isHardwareAccelerationEnabled) =>
                void handleSaveSettings({ isHardwareAccelerationEnabled })
              }
            />
          </SettingsItemRow>
          <SettingsItemRow label="界面大小" description="不缩放位图，按排版系统重新布局。">
            <select
              value={settings.uiScale}
              className="settings-inline-select"
              onChange={(event) =>
                void handleSaveSettings({
                  uiScale: Number(event.target.value) as AppSettings["uiScale"],
                })
              }
            >
              <option value={100}>100%</option>
              <option value={110}>110%</option>
              <option value={125}>125%</option>
            </select>
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
          micTestPhase={micTest.phase}
          isMicClipping={micTest.isClipping}
          micTestError={micTest.error}
          onToggleMicTest={() => void micTest.toggle()}
          onAutoCalibrate={() => {
            void micTest
              .calibrate()
              .then(async (inputLevelThreshold) => {
                await handleSaveSettings({ inputLevelThreshold });
                pushToast({
                  tone: "success",
                  title: "麦克风校准完成",
                  description: `输入阈值已自动设为 ${Math.round(inputLevelThreshold * 100)}。`,
                });
              })
              .catch((error) => {
                if (error instanceof Error && error.message === "mic_calibration_cancelled") return;
                pushToast({
                  tone: "danger",
                  title: "校准失败",
                  description: "请确认麦克风权限后重试。",
                });
              });
          }}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
        <ShortcutSettingsCard
          settings={settings}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
      </div>
    ),
    notifications: (
      <SettingsSection title="通知与提示音" description="保留必要的轻提示，不打扰开黑。">
        <div className="space-y-3">
          <SettingsItemRow label="提示音音量" description="加入、离开、消息和操作提示统一调节。">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              aria-label="提示音音量"
              onChange={(event) =>
                void handleSaveSettings({ soundVolume: Number(event.target.value) })
              }
            />
          </SettingsItemRow>
          <SettingsItemRow label="系统通知" description="全屏游戏时提醒好友上线或敲你。">
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
            <Button variant="secondary" onClick={() => void checkUpdates()}>
              检查更新
            </Button>
            <Button variant="ghost" onClick={() => void openReleases()}>
              查看发布页
            </Button>
          </div>
        </div>
      </SettingsSection>
    ),
    diagnostics: (
      <div className="space-y-4">
        <DiagnosticsSettingsCard
          diagnostics={diagnostics}
          relay={relayDiagnostics}
          connectionHealth={connectionHealth}
          localAudioDiagnostics={localAudioDiagnostics}
          webrtcReadyPeerCount={runtimeDiagnostics?.webrtcReadyPeerCount ?? 0}
          remotePeerCount={runtimeDiagnostics?.remotePeerCount ?? 0}
          audioRelayActive={isAudioRelayActive}
          onOpenLogs={() => void window.desktopApi.diagnostics.openLogsDirectory()}
          onExportBundle={handleExportBundle}
          onCopySummary={handleCopyDiagnostics}
        />
        <Button variant="danger" onClick={() => void resetSettings().then(refreshDiagnostics)}>
          安全重置设置
        </Button>
      </div>
    ),
  };

  return (
    <PageContainer className="settings-page overflow-y-auto">
      <div ref={pageRef} className="contents">
        <div data-gsap-settings="header">
          <SettingsPageHeader onBack={() => navigate(settingsReturnTo)} />
        </div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[168px_minmax(0,1fr)]">
          <nav
            data-gsap-settings="nav"
            className="settings-nav glass-panel h-fit rounded-[22px] p-2"
          >
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSection(id)}
                className={`flex w-full items-center gap-3 whitespace-nowrap rounded-[14px] px-3 py-2.5 text-left text-sm font-semibold transition ${
                  activeSection === id
                    ? "bg-[#eaf1ff] text-[#3f6ed7]"
                    : "text-[#718096] hover:bg-white/70"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
          <div data-gsap-settings="content" className="min-w-0">
            <div className="mb-2 text-right text-xs text-[#7c8da2]" aria-live="polite">
              {saveNotice}
            </div>
            {content[activeSection]}
          </div>
        </div>
      </div>
    </PageContainer>
  );
};
