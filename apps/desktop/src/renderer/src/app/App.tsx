import { useEffect } from "react";

import { AppErrorBoundary } from "../components/layout/AppErrorBoundary";
import { AppShell } from "../components/layout/AppShell";
import { RemoteAudioRenderer } from "../features/audio/RemoteAudioRenderer";
import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { useGlobalMuteSync } from "../hooks/useGlobalMuteSync";
import { useLocalAudioTransport } from "../hooks/useLocalAudioTransport";
import { HomePage } from "../pages/HomePage";
import { ProfileSetupPage } from "../pages/ProfileSetupPage";
import { RoomPage } from "../pages/RoomPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SharedOverlays } from "../pages/SharedOverlays";
import { useAppStore } from "../store/appStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { writeRendererLog } from "../utils/logger";

export const App = () => {
  useAppBootstrap();
  useGlobalMuteSync();
  useLocalAudioTransport();

  const currentPage = useAppStore((state) => state.currentPage);
  const isHydrating = useSettingsStore((state) => state.isHydrating);
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const syncLocalProfile = useRoomStore((state) => state.syncLocalProfile);

  useEffect(() => {
    if (!settings) {
      return;
    }

    syncLocalProfile({
      nickname: settings.nickname,
      avatarPath: settings.avatarPath,
      avatarDataUrl,
    });
  }, [avatarDataUrl, settings, syncLocalProfile]);

  const shouldShowProfileSetup = Boolean(
    settings && !settings.hasCompletedProfileSetup,
  );

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

  return (
    <AppShell>
      <AppErrorBoundary>
        {isHydrating ? null : (
          <>
            {shouldShowProfileSetup ? <ProfileSetupPage /> : null}
            {!shouldShowProfileSetup && currentPage === "home" ? <HomePage /> : null}
            {!shouldShowProfileSetup && currentPage === "room" ? <RoomPage /> : null}
            {!shouldShowProfileSetup && currentPage === "settings" ? <SettingsPage /> : null}
            <RemoteAudioRenderer />
          </>
        )}
      </AppErrorBoundary>
      <SharedOverlays />
    </AppShell>
  );
};
