import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Activity,
  CalendarDays,
  Headphones,
  Library,
  MonitorCog,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { gsap } from "gsap";

import type {
  AppSettings,
  DiagnosticsSnapshot,
  RelayStatusSnapshot,
  RendererDiagnosticsSummary,
  RuntimeHealthSnapshot,
  WindowsIntegrationStatus,
} from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import { Button } from "../components/base/Button";
import { Switch } from "../components/base/Switch";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
import { rendererPerformanceMonitor } from "../features/diagnostics/rendererPerformanceMonitor";
import { PageContainer } from "../components/layout/PageContainer";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";
import { DiagnosticsSettingsCard } from "../components/settings/DiagnosticsSettingsCard";
import { SettingsItemRow } from "../components/settings/SettingsItemRow";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { SettingsSection } from "../components/settings/SettingsSection";
import { ShortcutSettingsCard } from "../components/settings/ShortcutSettingsCard";
import { RecordingLibrarySettingsCard } from "../components/settings/RecordingLibrarySettingsCard";
import { AiVoiceMemorySettingsCard } from "../components/settings/AiVoiceMemorySettingsCard";
import { RoomHistorySettingsCard } from "../components/settings/RoomHistorySettingsCard";
import { WeatherSettingsCard } from "../components/settings/WeatherSettingsCard";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { ReleaseDetailModal } from "../components/status/ReleaseDetailModal";
import { RELEASE_HISTORY, type ReleaseHistoryEntry } from "../components/status/releaseHistory";
import { useMicTest } from "../hooks/useMicTest";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { getRoomRuntimeDiagnostics, injectRealtimeFault } from "../hooks/useRoomState";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

type SettingsSectionId =
  "general" | "audio" | "recordings" | "ai" | "roomHistory" | "updates" | "diagnostics";

const sections = [
  { id: "general", label: "通用", icon: MonitorCog },
  { id: "audio", label: "语音", icon: Headphones },
  { id: "recordings", label: "录音库", icon: Library },
  { id: "ai", label: "AI 功能", icon: Sparkles },
  { id: "roomHistory", label: "房间记录", icon: CalendarDays },
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

let cachedWindowsDiagnostics: WindowsIntegrationStatus | undefined;

export const SettingsPage = () => {
  const navigate = useAppStore((state) => state.navigate);
  const settingsReturnTo = useAppStore((state) => state.settingsReturnTo);
  const pushToast = useAppStore((state) => state.pushToast);
  const voiceMemoryOpenTarget = useAppStore((state) => state.voiceMemoryOpenTarget);
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
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthSnapshot>();
  const [relayDiagnostics, setRelayDiagnostics] = useState<RelayStatusSnapshot>();
  const [windowsDiagnostics, setWindowsDiagnostics] = useState<
    WindowsIntegrationStatus | undefined
  >(cachedWindowsDiagnostics);
  const [isWindowsDiagnosticsLoading, setIsWindowsDiagnosticsLoading] =
    useState(!cachedWindowsDiagnostics);
  const [isRepairingFirewall, setIsRepairingFirewall] = useState(false);
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");
  const [selectedRelease, setSelectedRelease] = useState<ReleaseHistoryEntry>();
  const pageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const isSettingsReady = Boolean(settings);

  const micTest = useMicTest({
    inputDeviceId: settings?.preferredInputDeviceId,
    outputDeviceId: settings?.preferredOutputDeviceId,
    echoCancellation: settings?.isEchoCancellationEnabled,
    noiseSuppression: settings?.isNoiseSuppressionEnabled,
    autoGainControl: settings?.isAutoGainControlEnabled,
    voiceEnhancement: settings?.isVoiceEnhancementEnabled,
    monitorMode: settings?.micMonitorMode,
    equalizerGains: settings?.micEqualizerGains,
    lowCutFrequency: settings?.lowCutFrequency,
  });

  useEffect(() => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  }, []);

  useEffect(() => {
    if (voiceMemoryOpenTarget) setActiveSection("recordings");
  }, [voiceMemoryOpenTarget]);

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

  useEffect(() => {
    if (activeSection !== "diagnostics") return;
    let cancelled = false;
    const stopPerformanceMonitor = rendererPerformanceMonitor.start();

    const refresh = async () => {
      const runtime = getRoomRuntimeDiagnostics();
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
          serverUrl: sanitizeDiagnosticsServerUrl(room.signalingUrl ?? settings?.relayServerUrl),
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
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stopPerformanceMonitor();
    };
  }, [
    activeSection,
    localStream,
    remoteStreams,
    room.connectionState,
    room.lifecycleState,
    room.roomId,
    room.signalingUrl,
    settings?.relayServerUrl,
  ]);

  useEffect(() => {
    let cancelled = false;
    setIsWindowsDiagnosticsLoading(!cachedWindowsDiagnostics);
    void window.desktopApi.windows
      .getStatus()
      .then((snapshot) => {
        if (cancelled) return;
        cachedWindowsDiagnostics = snapshot;
        setWindowsDiagnostics(snapshot);
      })
      .catch(() => {
        if (!cancelled && !cachedWindowsDiagnostics) setWindowsDiagnostics(undefined);
      })
      .finally(() => {
        if (!cancelled) setIsWindowsDiagnosticsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (!settings) {
    return <StartupSplashPage message="正在准备设置..." />;
  }

  const refreshDiagnostics = () =>
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  const refreshWindowsDiagnostics = () => {
    setIsWindowsDiagnosticsLoading(true);
    void window.desktopApi.windows
      .getStatus()
      .then((snapshot) => {
        cachedWindowsDiagnostics = snapshot;
        setWindowsDiagnostics(snapshot);
      })
      .finally(() => setIsWindowsDiagnosticsLoading(false));
  };
  const handleRepairFirewall = () => {
    if (isRepairingFirewall) return;
    setIsRepairingFirewall(true);
    void window.desktopApi.windows
      .repairFirewall()
      .then((firewall) => {
        setWindowsDiagnostics((current) => (current ? { ...current, firewall } : current));
        pushToast({
          tone: firewall.healthy ? "success" : "danger",
          title: firewall.healthy ? "防火墙规则已修复" : "防火墙修复未完成",
          description: firewall.healthy ? "TCP/UDP 双向规则已正常启用。" : firewall.message,
        });
      })
      .catch((error) =>
        pushToast({
          tone: "danger",
          title: "防火墙修复失败",
          description: error instanceof Error ? error.message : "请确认管理员权限后重试。",
        }),
      )
      .finally(() => setIsRepairingFirewall(false));
  };
  const handleIconOverlayChange = (hidden: boolean) => {
    void window.desktopApi.windows
      .setIconOverlaysHidden(hidden)
      .then((iconOverlays) => {
        setWindowsDiagnostics((current) => {
          if (!current) return current;
          const next = { ...current, iconOverlays };
          cachedWindowsDiagnostics = next;
          return next;
        });
        pushToast({
          tone: "success",
          title: hidden ? "桌面图标标记已隐藏" : "桌面图标标记已恢复",
          description: hidden
            ? "快捷方式小箭头和管理员盾牌已隐藏，软件仍会正常请求管理员权限。"
            : "已恢复修改前的 Windows 图标标记。",
        });
      })
      .catch((error) =>
        pushToast({
          tone: "danger",
          title: hidden ? "隐藏失败" : "恢复失败",
          description: error instanceof Error ? error.message : "请允许 Windows 管理员确认后重试。",
        }),
      );
  };
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
      relayStatus: relayDiagnostics
        ? {
            ...relayDiagnostics,
            serverUrl: sanitizeDiagnosticsServerUrl(relayDiagnostics.serverUrl),
          }
        : undefined,
      screenShareRelayState: runtime?.screenShareRelayState,
      screenShare: runtime?.screenShare,
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
      `管理员权限：${windowsDiagnostics?.elevation.isElevated ? "已启用" : "未启用"}`,
      `防火墙：${windowsDiagnostics?.firewall.healthy ? "正常" : "需要修复"}`,
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
      <SettingsSection title="应用" description="控制窗口与图形渲染。">
        <div className="space-y-3">
          <SettingsItemRow
            label="开机自动上号"
            description="开机后自动打开上号并进入上次使用的房间；为避免打扰，麦克风会保持关闭。"
          >
            <Switch
              isChecked={settings.launchOnStartup}
              onChange={(launchOnStartup) => void handleSaveSettings({ launchOnStartup })}
            />
          </SettingsItemRow>
          <SettingsItemRow label="关闭窗口时留在后台">
            <Switch
              isChecked={settings.minimizeToTray}
              onChange={(minimizeToTray) => void handleSaveSettings({ minimizeToTray })}
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="开启工作显示"
            description="显示自己和好友持续使用的专业工作软件；游戏和音乐不受影响。"
          >
            <Switch
              isChecked={settings.isWorkActivityVisible}
              onChange={(isWorkActivityVisible) =>
                void handleSaveSettings({ isWorkActivityVisible })
              }
            />
          </SettingsItemRow>
          <SettingsItemRow
            label="桌面图标标记"
            description="隐藏 Windows 桌面所有快捷方式的小箭头和管理员盾牌；不删除图标，也不取消管理员启动。"
          >
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={isWindowsDiagnosticsLoading || windowsDiagnostics?.iconOverlays.hidden}
                onClick={() => handleIconOverlayChange(true)}
              >
                {isWindowsDiagnosticsLoading ? "读取状态…" : "一键隐藏"}
              </Button>
              <Button
                variant="ghost"
                disabled={
                  isWindowsDiagnosticsLoading || windowsDiagnostics?.iconOverlays.hidden !== true
                }
                onClick={() => handleIconOverlayChange(false)}
              >
                恢复默认
              </Button>
            </div>
          </SettingsItemRow>
          <WeatherSettingsCard
            settings={settings}
            onChange={(patch) => void handleSaveSettings(patch)}
          />
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
          onPlaySystemCapture={() => void micTest.playSystemCapture()}
          onPlayProcessed={() => void micTest.playProcessed()}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
        <ShortcutSettingsCard
          settings={settings}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
      </div>
    ),
    recordings: (
      <RecordingLibrarySettingsCard
        settings={settings}
        onChange={handleSaveSettings}
        pushToast={pushToast}
        openTarget={voiceMemoryOpenTarget}
      />
    ),
    ai: (
      <AiVoiceMemorySettingsCard
        settings={settings}
        onChange={handleSaveSettings}
        pushToast={pushToast}
      />
    ),
    roomHistory: <RoomHistorySettingsCard settings={settings} onChange={handleSaveSettings} />,
    updates: (
      <SettingsSection title="更新" description={`当前版本 ${runtimeInfo?.version ?? "读取中..."}`}>
        <div className="flex items-center justify-between gap-3 border-b border-[#dbe8f7]/80 pb-4">
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
        <div className="mt-4 grid gap-3" aria-label="完整版本更新记录">
          {RELEASE_HISTORY.map((release, index) => (
            <article
              key={release.version}
              className="overflow-hidden rounded-[18px] border border-[#dbe8f7]/80 bg-white/58"
            >
              <button
                type="button"
                className="w-full px-4 py-3.5 text-left transition-colors hover:bg-white/62"
                aria-haspopup="dialog"
                onClick={() => setSelectedRelease(release)}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <strong className="text-sm text-[#26364d]">上号 {release.version}</strong>
                    {index === 0 ? (
                      <span className="rounded-full bg-[#e8f2ff] px-2 py-0.5 text-[11px] font-bold text-[#3974d8]">
                        最新
                      </span>
                    ) : null}
                  </div>
                  <time className="text-xs text-[#8a9ab0]">{release.date}</time>
                </div>
                <div className="mt-1 text-sm font-semibold text-[#52647b]">{release.title}</div>
                <ul className="mt-2 grid gap-1 text-[13px] leading-5 text-[#718096]">
                  {release.highlights.map((highlight) => (
                    <li key={highlight} className="flex gap-2">
                      <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-[#6da6ef]" />
                      <span>{highlight}</span>
                    </li>
                  ))}
                </ul>
                <span className="mt-2.5 inline-flex text-xs font-semibold text-[#3974d8]">
                  查看详细信息
                </span>
              </button>
            </article>
          ))}
        </div>
      </SettingsSection>
    ),
    diagnostics: (
      <div className="space-y-4">
        <DiagnosticsSettingsCard
          diagnostics={diagnostics}
          runtimeHealth={runtimeHealth}
          relay={relayDiagnostics}
          connectionHealth={connectionHealth}
          localAudioDiagnostics={localAudioDiagnostics}
          webrtcReadyPeerCount={runtimeDiagnostics?.webrtcReadyPeerCount ?? 0}
          remotePeerCount={runtimeDiagnostics?.remotePeerCount ?? 0}
          audioRelayActive={isAudioRelayActive}
          peerHealth={runtimeDiagnostics?.peerHealth}
          longSessionSampleCount={runtimeDiagnostics?.longSessionAudio.length ?? 0}
          screenShare={runtimeDiagnostics?.screenShare}
          windowsStatus={windowsDiagnostics}
          onOpenLogs={() => void window.desktopApi.diagnostics.openLogsDirectory()}
          onExportBundle={handleExportBundle}
          onCopySummary={handleCopyDiagnostics}
          onRefreshWindows={refreshWindowsDiagnostics}
          onRepairFirewall={handleRepairFirewall}
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
              .catch((error) =>
                pushToast({
                  tone: "danger",
                  title: "故障注入失败",
                  description: error instanceof Error ? error.message : String(error),
                }),
              )
          }
        />
        <Button variant="danger" onClick={() => void resetSettings().then(refreshDiagnostics)}>
          安全重置设置
        </Button>
      </div>
    ),
  };

  return (
    <>
      <PageContainer
        className={`settings-page ${
          activeSection === "recordings"
            ? "settings-page--recording-library overflow-hidden"
            : "overflow-y-auto"
        }`}
      >
        <div
          ref={pageRef}
          className={cn(
            "settings-page-shell",
            activeSection === "recordings" && "settings-recording-shell",
          )}
        >
          <div data-gsap-settings="header">
            <SettingsPageHeader saveNotice={saveNotice} onBack={() => navigate(settingsReturnTo)} />
          </div>
          <div
            className={`mt-2 grid gap-5 lg:grid-cols-[168px_minmax(0,1fr)] ${
              activeSection === "recordings" ? "settings-recording-layout" : ""
            }`}
          >
            <nav
              data-gsap-settings="nav"
              className="settings-nav glass-panel h-fit rounded-[22px] p-2"
            >
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveSection(id)}
                  className={`flex w-full items-center gap-3 whitespace-nowrap rounded-[14px] px-3 py-2.5 text-left text-sm font-semibold transition-colors duration-100 ${
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
            <div
              data-gsap-settings="content"
              className={`min-w-0 ${
                activeSection === "recordings" ? "settings-recording-content" : ""
              }`}
            >
              {content[activeSection]}
            </div>
          </div>
        </div>
      </PageContainer>
      <ReleaseDetailModal release={selectedRelease} onClose={() => setSelectedRelease(undefined)} />
    </>
  );
};
