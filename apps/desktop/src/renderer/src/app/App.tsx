import { lazy, Suspense, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  APPLE_MOTION_SPATIAL_EASE,
} from "@private-voice/shared";

import { AppErrorBoundary } from "../components/layout/AppErrorBoundary";
import { AppShell } from "../components/layout/AppShell";
import { RemoteAudioRenderer } from "../features/audio/RemoteAudioRenderer";
import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { useGlobalMuteSync } from "../hooks/useGlobalMuteSync";
import { useLocalAudioTransport } from "../hooks/useLocalAudioTransport";
import { useUiFeedbackSounds } from "../hooks/useUiFeedbackSounds";
import { HomePage } from "../pages/HomePage";
import { SharedOverlays } from "../pages/SharedOverlays";
import { useAppStore } from "../store/appStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";
import { StartupRecoveryPage } from "../components/status/StartupRecoveryPage";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { UpdateGatePage } from "../components/status/UpdateGatePage";

const loadRoomPage = () => import("../pages/RoomPage");
const loadSettingsPage = () => import("../pages/SettingsPage");
const roomPagePromise = loadRoomPage();
const RoomPage = lazy(() => roomPagePromise.then(({ RoomPage: Page }) => ({ default: Page })));
const SettingsPage = lazy(() =>
  loadSettingsPage().then(({ SettingsPage: Page }) => ({ default: Page })),
);

export const App = () => {
  useAppBootstrap();
  useGlobalMuteSync();
  useLocalAudioTransport();
  useUiFeedbackSounds();

  const currentPage = useAppStore((state) => state.currentPage);
  const settingsReturnTo = useAppStore((state) => state.settingsReturnTo);
  const bootstrapPhase = useAppStore((state) => state.bootstrapPhase);
  const bootstrapMessage = useAppStore((state) => state.bootstrapMessage);
  const startupIssue = useAppStore((state) => state.startupIssue);
  const retryBootstrap = useAppStore((state) => state.retryBootstrap);
  const completeBootstrap = useAppStore((state) => state.completeBootstrap);
  const isHydrating = useSettingsStore((state) => state.isHydrating);
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const syncLocalProfile = useRoomStore((state) => state.syncLocalProfile);

  useEffect(() => {
    if (!settings || bootstrapPhase !== "ready") {
      return;
    }

    syncLocalProfile({
      nickname: settings.nickname,
      avatarPath: settings.avatarPath,
      avatarDataUrl,
      avatarId: settings.avatarId,
    });
  }, [avatarDataUrl, bootstrapPhase, settings, syncLocalProfile]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = `${settings?.uiScale ?? 100}%`;
    return () => {
      root.style.removeProperty("font-size");
    };
  }, [settings?.uiScale]);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      void writeRendererLog("app", "error", "Unhandled renderer error", {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? { message: event.reason.message, stack: event.reason.stack }
          : { reason: String(event.reason) };

      void writeRendererLog("app", "error", "Unhandled promise rejection", reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  useEffect(() => {
    if (bootstrapPhase !== "ready") {
      return;
    }

    const preloadPages = () => {
      void loadSettingsPage();
    };

    const requestId = window.requestIdleCallback(preloadPages, { timeout: 1_200 });
    return () => window.cancelIdleCallback(requestId);
  }, [bootstrapPhase]);

  const renderPage = () => {
    if (bootstrapPhase === "booting" || bootstrapPhase === "checking-update" || isHydrating) {
      return <StartupSplashPage message={bootstrapMessage} />;
    }

    if (bootstrapPhase === "update-gate") {
      return <UpdateGatePage />;
    }

    if (bootstrapPhase === "recovery") {
      return (
        <StartupRecoveryPage
          issue={startupIssue}
          onRetry={retryBootstrap}
          onContinue={completeBootstrap}
        />
      );
    }

    const isSettingsOpen = currentPage === "settings";
    const basePage = isSettingsOpen ? settingsReturnTo : currentPage;

    return (
      <Suspense fallback={<StartupSplashPage message="正在打开页面..." />}>
        <div className="app-page-stack">
          <div
            className={`app-page-layer app-page-base ${isSettingsOpen ? "is-obscured" : ""}`}
            aria-hidden={isSettingsOpen || undefined}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={basePage}
                className="app-route-motion"
                initial={{ opacity: 0, x: basePage === "room" ? 18 : -12, scale: 0.992 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: basePage === "room" ? -10 : 10, scale: 0.996 }}
                transition={{
                  opacity: { duration: APPLE_MOTION_DURATION.panel, ease: APPLE_MOTION_EASE },
                  x: {
                    duration: APPLE_MOTION_DURATION.page,
                    ease: APPLE_MOTION_SPATIAL_EASE,
                  },
                  scale: {
                    duration: APPLE_MOTION_DURATION.page,
                    ease: APPLE_MOTION_SPATIAL_EASE,
                  },
                }}
              >
                {basePage === "room" ? <RoomPage /> : <HomePage />}
              </motion.div>
            </AnimatePresence>
          </div>
          {isSettingsOpen ? (
            <div className="app-page-layer app-page-settings">
              <SettingsPage />
            </div>
          ) : null}
        </div>
      </Suspense>
    );
  };

  return (
    <AppShell>
      <AppErrorBoundary>
        {renderPage()}
        {bootstrapPhase === "ready" ? <RemoteAudioRenderer /> : null}
      </AppErrorBoundary>
      <SharedOverlays />
    </AppShell>
  );
};
