import { GeneralSettingsCard } from "../components/settings/GeneralSettingsCard";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { gsap } from "gsap";

import type { AppSettings, WindowsIntegrationStatus } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import { playUiSound } from "../features/audio/uiSound";
import { motionDuration, motionEase } from "../features/motion/motionSystem";
import { interactionPerformanceMonitor } from "../features/diagnostics/interactionPerformanceMonitor";
import { rendererPerformanceMonitor } from "../features/diagnostics/rendererPerformanceMonitor";
import { useRenderProfiler } from "../features/diagnostics/renderProfiler";
import { observeWindowsIntegration } from "../features/diagnostics/observeWindowsIntegration";
import {
  cacheSettingsSection,
  getInitialSettingsSection,
  readRequestedSettingsSection,
  settingsSectionSignature,
  type SettingsSectionId,
} from "../features/settings/settingsSectionState";
import { PageContainer } from "../components/layout/PageContainer";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";
import { AboutSettingsCard } from "../components/settings/AboutSettingsCard";
import { AccountSettingsCard } from "../components/settings/AccountSettingsCard";
import { SettingsDiagnosticsSection } from "../components/settings/SettingsDiagnosticsSection";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import {
  SettingsNavigation,
  settingsSections as sections,
} from "../components/settings/SettingsNavigation";
import { QuickMessageSettingsCard } from "../components/settings/QuickMessageSettingsCard";
import {
  preloadRecordingLibrary,
  RecordingLibrarySettingsCard as RecordingLibrarySettingsCardView,
} from "../components/settings/RecordingLibrarySettingsCard";
import {
  preloadAiVoiceMemorySnapshot,
  AiVoiceMemorySettingsCard as AiVoiceMemorySettingsCardView,
} from "../components/settings/AiVoiceMemorySettingsCard";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";
import { toUserFacingError } from "../utils/userFacingError";

const RecordingLibrarySettingsCard = memo(RecordingLibrarySettingsCardView);
const AiVoiceMemorySettingsCard = memo(AiVoiceMemorySettingsCardView);

let cachedWindowsDiagnostics: WindowsIntegrationStatus | undefined;

export const SettingsPage = ({ isActive = true }: { isActive?: boolean }) => {
  const navigate = useAppStore((state) => state.navigate);
  const settingsReturnTo = useAppStore((state) => state.settingsReturnTo);
  const pushToast = useAppStore((state) => state.pushToast);
  const voiceMemoryOpenTarget = useAppStore((state) => state.voiceMemoryOpenTarget);
  const [settingsView, setSettingsView] = useState(() => {
    const initialSection = getInitialSettingsSection();
    return {
      activeSection: initialSection,
      visitedSections: new Set<SettingsSectionId>([initialSection]),
    };
  });
  const { activeSection } = settingsView;
  useSettingsStore((state) => settingsSectionSignature(state.settings, activeSection));
  const settings = useSettingsStore.getState().settings;
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const updateStatus = useSettingsStore((state) => state.updateStatus);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const checkUpdates = useSettingsStore((state) => state.checkUpdates);
  const openReleases = useSettingsStore((state) => state.openReleases);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const [windowsDiagnostics, setWindowsDiagnostics] = useState<
    WindowsIntegrationStatus | undefined
  >(cachedWindowsDiagnostics);
  const [isWindowsDiagnosticsLoading, setIsWindowsDiagnosticsLoading] =
    useState(!cachedWindowsDiagnostics);
  const [isRepairingFirewall, setIsRepairingFirewall] = useState(false);
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");
  const pageRef = useRef<HTMLDivElement>(null);
  const entranceActiveRef = useRef(false);
  const reduceMotion = usePrefersReducedMotion();
  const isSettingsReady = Boolean(settings);

  useRenderProfiler("SettingsPage", {
    activeSection,
    cachedSections: settingsView.visitedSections.size,
    isActive,
  });

  useEffect(() => {
    if (!import.meta.env.DEV || !isActive) return;
    return rendererPerformanceMonitor.start();
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    const idleIds: number[] = [];
    const timerIds: number[] = [];
    const scheduleIdle = (task: () => void, timeout: number, fallbackDelay: number) => {
      if (typeof window.requestIdleCallback === "function") {
        idleIds.push(window.requestIdleCallback(task, { timeout }));
      } else {
        timerIds.push(window.setTimeout(task, fallbackDelay));
      }
    };

    // Warm only data. Mounting both large pages while they are hidden retains thousands of DOM
    // nodes and makes the first visible transition compete with unrelated background work.
    scheduleIdle(() => void preloadAiVoiceMemorySnapshot().catch(() => undefined), 900, 160);
    scheduleIdle(() => void preloadRecordingLibrary().catch(() => undefined), 2_800, 1_100);

    return () => {
      idleIds.forEach((id) => window.cancelIdleCallback?.(id));
      timerIds.forEach((id) => window.clearTimeout(id));
    };
  }, [isActive]);

  const handleSaveSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      setSaveNotice("正在保存...");
      try {
        await saveSettings(patch);
        setSaveNotice("已保存");
      } catch (error) {
        setSaveNotice("保存失败");
        pushToast({
          tone: "danger",
          ...toUserFacingError(error, "settings"),
        });
        throw error;
      }
    },
    [pushToast, saveSettings],
  );

  useEffect(() => {
    if (!isActive) return;
    const requestedSection = readRequestedSettingsSection();
    if (!requestedSection) return;
    setSettingsView((current) => ({
      activeSection: requestedSection,
      visitedSections: cacheSettingsSection(current.visitedSections, requestedSection),
    }));
  }, [isActive]);

  useEffect(() => {
    if (voiceMemoryOpenTarget) {
      setSettingsView((current) => {
        if (current.activeSection === "recordings") return current;
        return {
          activeSection: "recordings",
          visitedSections: cacheSettingsSection(current.visitedSections, "recordings"),
        };
      });
    }
  }, [voiceMemoryOpenTarget]);

  useEffect(() => {
    if (!isActive || (activeSection !== "general" && activeSection !== "diagnostics")) return;
    setIsWindowsDiagnosticsLoading(!cachedWindowsDiagnostics);
    return observeWindowsIntegration(
      (snapshot) => {
        cachedWindowsDiagnostics = snapshot;
        setWindowsDiagnostics(snapshot);
      },
      () => setIsWindowsDiagnosticsLoading(false),
      () => {
        if (!cachedWindowsDiagnostics) setWindowsDiagnostics(undefined);
      },
    );
  }, [activeSection, isActive]);

  useLayoutEffect(() => {
    const opening = isActive && !entranceActiveRef.current;
    entranceActiveRef.current = isActive;
    if (!isActive || !isSettingsReady || !pageRef.current) return;

    const context = gsap.context(() => {
      if (reduceMotion) return;

      const targets = opening
        ? "[data-gsap-settings='header'], [data-gsap-settings='nav'], [data-gsap-settings='content']"
        : "[data-gsap-settings='content']";
      gsap.set(targets, { willChange: "transform,opacity" });
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 6 },
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
  }, [activeSection, isActive, isSettingsReady, reduceMotion]);

  if (!settings) {
    return <StartupSplashPage message="正在准备设置..." />;
  }

  const selectSection = (nextSection: SettingsSectionId) => {
    if (nextSection === activeSection) return;
    const interactionId = interactionPerformanceMonitor.begin(
      `settings:${activeSection}->${nextSection}`,
      "settings",
    );
    interactionPerformanceMonitor.mark(interactionId, "visual-feedback-start");
    playUiSound("settings-section");
    interactionPerformanceMonitor.mark(interactionId, "route-transition-start");
    setSettingsView((current) => {
      if (current.activeSection === nextSection) return current;
      return {
        activeSection: nextSection,
        visitedSections: cacheSettingsSection(current.visitedSections, nextSection),
      };
    });
    interactionPerformanceMonitor.afterNextPaint(interactionId);
  };

  const refreshWindowsDiagnostics = async (): Promise<void> => {
    setIsWindowsDiagnosticsLoading(true);
    try {
      const snapshot = await window.desktopApi.windows.getStatus();
      cachedWindowsDiagnostics = snapshot;
      setWindowsDiagnostics(snapshot);
    } finally {
      setIsWindowsDiagnosticsLoading(false);
    }
  };
  const handleRepairFirewall = () => {
    if (isRepairingFirewall) return;
    setIsRepairingFirewall(true);
    void window.desktopApi.windows
      .repairFirewall()
      .then((firewall) => {
        setWindowsDiagnostics((current) => {
          cachedWindowsDiagnostics = current ? { ...current, firewall } : current;
          return cachedWindowsDiagnostics;
        });
        pushToast({
          tone: firewall.healthy ? "success" : "danger",
          title: firewall.healthy ? "防火墙规则已修复" : "防火墙修复未完成",
          description: firewall.healthy ? "TCP/UDP 双向规则已正常启用。" : firewall.message,
        });
      })
      .catch((error) => pushToast({ tone: "danger", ...toUserFacingError(error, "settings") }))
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
            ? "快捷方式小箭头已隐藏；管理员盾牌仍由 Windows 正常显示。"
            : "已恢复修改前的 Windows 图标标记。",
        });
      })
      .catch((error) =>
        pushToast({
          tone: "danger",
          ...toUserFacingError(error, "settings"),
        }),
      );
  };
  const content: Record<SettingsSectionId, React.ReactNode> = {
    account: <AccountSettingsCard />,
    general: (
      <GeneralSettingsCard
        settings={settings}
        onChange={(patch) => void handleSaveSettings(patch)}
        windowsStatus={windowsDiagnostics}
        loadingWindows={isWindowsDiagnosticsLoading}
        onIconOverlayChange={handleIconOverlayChange}
        isActive={isActive && activeSection === "general"}
      />
    ),
    audio: (
      <div className="space-y-4">
        <AudioSettingsCard
          settings={settings}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          onChange={(patch) => void handleSaveSettings(patch)}
        />
      </div>
    ),
    quickMessages: (
      <QuickMessageSettingsCard
        settings={settings}
        onChange={(patch) => void handleSaveSettings(patch)}
        onExport={async () => {
          try {
            const directory = await window.desktopApi.quickMessages.export();
            if (directory) {
              pushToast({
                tone: "success",
                title: "语音包已导出",
                description: `已保存到：${directory}`,
              });
            }
          } catch {
            pushToast({ tone: "danger", title: "导出失败", description: "请重试。" });
          }
        }}
      />
    ),
    recordings: (
      <RecordingLibrarySettingsCard
        isActive={isActive && activeSection === "recordings"}
        settings={settings}
        onChange={handleSaveSettings}
        pushToast={pushToast}
        openTarget={voiceMemoryOpenTarget}
      />
    ),
    ai: (
      <AiVoiceMemorySettingsCard
        isActive={isActive && activeSection === "ai"}
        settings={settings}
        onChange={handleSaveSettings}
        pushToast={pushToast}
      />
    ),
    about: (
      <AboutSettingsCard
        runtimeInfo={runtimeInfo}
        updateInfo={updateInfo}
        updateStatus={updateStatus}
        onCheckUpdates={checkUpdates}
        onOpenReleases={openReleases}
      />
    ),
    diagnostics:
      isActive && activeSection === "diagnostics" ? (
        <SettingsDiagnosticsSection
          settings={settings}
          windowsStatus={windowsDiagnostics}
          isRepairingFirewall={isRepairingFirewall}
          onRefreshWindows={refreshWindowsDiagnostics}
          onRepairFirewall={handleRepairFirewall}
          onOpenAudioSettings={() => selectSection("audio")}
          onOpenAiSettings={() => selectSection("ai")}
        />
      ) : null,
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
            <SettingsNavigation activeSection={activeSection} onSelect={selectSection} />
            <div className="min-w-0">
              {sections.map(({ id }) => {
                if (!settingsView.visitedSections.has(id)) return null;
                const isCurrentSection = id === activeSection;
                return (
                  <div
                    key={id}
                    data-gsap-settings={isCurrentSection ? "content" : undefined}
                    hidden={!isCurrentSection}
                    aria-hidden={!isCurrentSection}
                    className={`settings-section-motion min-w-0 ${
                      id === "recordings" ? "settings-recording-content" : ""
                    }`}
                  >
                    {content[id]}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </PageContainer>
    </>
  );
};
