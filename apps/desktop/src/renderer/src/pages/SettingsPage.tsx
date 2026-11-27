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
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const [windowsDiagnostics, setWindowsDiagnostics] = useState<
    WindowsIntegrationStatus | undefined
  >(cachedWindowsDiagnostics);
  const [isWindowsDiagnosticsLoading, setIsWindowsDiagnosticsLoading] =
    useState(!cachedWindowsDiagnostics);
  const [isChangingIconOverlays, setIsChangingIconOverlays] = useState(false);
  const [saveNotice, setSaveNotice] = useState("设置会自动保存");
  const pageRef = useRef<HTMLDivElement>(null);
  const sectionScrollRef = useRef<HTMLDivElement>(null);
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
    if (!isActive || activeSection !== "general") return;
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
    sectionScrollRef.current?.scrollTo(0, 0);
  }, [activeSection]);

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
        { autoAlpha: opening ? 0 : 0.78, y: opening ? 6 : 3 },
        {
          autoAlpha: 1,
          y: 0,
          duration: opening ? motionDuration.panel : motionDuration.compact,
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

  const handleIconOverlayChange = (hidden: boolean) => {
    if (isChangingIconOverlays) return;
    setIsChangingIconOverlays(true);
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
          tone: hidden && !iconOverlays.hidden ? "warning" : "success",
          title: hidden
            ? iconOverlays.hidden
              ? "已设置隐藏图标标记"
              : "图标标记设置未完成"
            : "桌面图标标记已恢复",
          description: hidden
            ? "Windows 图标显示可能需要重新登录；管理员授权仍会正常弹出。"
            : "已撤销上号写入的标记设置，其他软件的更改会保留。",
        });
      })
      .catch((error) =>
        pushToast({
          tone: "danger",
          ...toUserFacingError(error, "settings"),
        }),
      )
      .finally(() => setIsChangingIconOverlays(false));
  };
  const content: Record<SettingsSectionId, React.ReactNode> = {
    account: <AccountSettingsCard />,
    general: (
      <GeneralSettingsCard
        settings={settings}
        onChange={(patch) => void handleSaveSettings(patch)}
        windowsStatus={windowsDiagnostics}
        loadingWindows={isWindowsDiagnosticsLoading || isChangingIconOverlays}
        onIconOverlayChange={handleIconOverlayChange}
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
        isActive={isActive && activeSection === "about"}
        runtimeInfo={runtimeInfo}
        updateInfo={updateInfo}
        updateStatus={updateStatus}
        onCheckUpdates={checkUpdates}
      />
    ),
  };

  return (
    <>
      <PageContainer
        className={`settings-page ${
          activeSection === "recordings"
            ? "settings-page--recording-library overflow-hidden"
            : "overflow-hidden"
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
              activeSection === "recordings" ? "settings-recording-layout" : "settings-fixed-layout"
            }`}
          >
            <SettingsNavigation activeSection={activeSection} onSelect={selectSection} />
            <div
              ref={sectionScrollRef}
              className="min-w-0"
              data-settings-content-scroll={activeSection !== "recordings" ? "" : undefined}
            >
              {sections.map(({ id }) => {
                if (!settingsView.visitedSections.has(id)) return null;
                const isCurrentSection = id === activeSection;
                return (
                  <div
                    key={id}
                    data-gsap-settings={isCurrentSection ? "content" : undefined}
                    hidden={!isCurrentSection}
                    aria-hidden={!isCurrentSection}
                    className={cn(
                      "settings-section-motion min-w-0",
                      id === "recordings" && "settings-recording-content",
                    )}
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
