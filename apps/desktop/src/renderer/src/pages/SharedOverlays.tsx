import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { RecordingState, RoomConnectionState } from "@private-voice/shared";

import { ModalHost } from "../components/layout/ModalHost";
import { ToastRegion } from "../components/layout/ToastRegion";
import { OnboardingModal } from "../components/status/OnboardingModal";
import { ReconnectOverlay } from "../components/status/ReconnectOverlay";
import { RecordingSaveDialog } from "../components/status/RecordingSaveDialog";
import { SafeModeBanner } from "../components/status/SafeModeBanner";
import { UpdateModal } from "../components/status/UpdateModal";
import { ReleaseNotesModal } from "../components/status/ReleaseNotesModal";
import { DailyRoomReportModal } from "../components/status/DailyRoomReportModal";
import { useAppStore } from "../store/appStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { useDailyRoomReportStore } from "../store/dailyRoomReportStore";

const getYesterdayDate = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date(Date.now() - 86_400_000),
  );

export const SharedOverlays = () => {
  const isOnboardingOpen = useAppStore((state) => state.isOnboardingOpen);
  const setOnboardingOpen = useAppStore((state) => state.setOnboardingOpen);
  const roomState = useRoomStore((state) => state.room.connectionState);
  const recordingStatus = useRecordingStore((state) => state.status);
  const resetRecordingStatus = useRecordingStore((state) => state.resetStatus);
  const isSafeMode = useAppStore((state) => state.isSafeMode);
  const startupIssue = useAppStore((state) => state.startupIssue);
  const dismissStartupIssue = useAppStore((state) => state.dismissStartupIssue);
  const retryBootstrap = useAppStore((state) => state.retryBootstrap);
  const bootstrapPhase = useAppStore((state) => state.bootstrapPhase);
  const currentPage = useAppStore((state) => state.currentPage);
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const roomId = useRoomStore((state) => (state.room.roomId === "side" ? "side" : "main"));
  const reports = useDailyRoomReportStore((state) => state.reports[roomId]);
  const reportsLoaded = useDailyRoomReportStore((state) => state.loaded[roomId]);
  const [welcomeQueueReady, setWelcomeQueueReady] = useState(false);
  const version = runtimeInfo?.version ?? "";
  const releasePending = Boolean(
    settings?.hasCompletedProfileSetup &&
    version &&
    version !== "0.0.0" &&
    settings.lastReleaseNotesVersionSeen !== version,
  );

  useEffect(() => {
    if (releasePending) {
      setWelcomeQueueReady(false);
      return;
    }
    const timer = window.setTimeout(() => setWelcomeQueueReady(true), 420);
    return () => window.clearTimeout(timer);
  }, [releasePending]);

  const yesterdayDate = getYesterdayDate();
  const yesterdayReport = reports.find((report) => report.date === yesterdayDate);
  const showDailyReport = Boolean(
    bootstrapPhase === "ready" &&
    welcomeQueueReady &&
    !releasePending &&
    !updateInfo?.forceUpdate &&
    currentPage === "room" &&
    reportsLoaded &&
    yesterdayReport?.hadActivity &&
    settings?.lastDailyRoomReportSeen?.[roomId] !== yesterdayDate &&
    (roomState === RoomConnectionState.Connected || roomState === RoomConnectionState.Degraded),
  );

  return (
    <>
      <ToastRegion />
      {bootstrapPhase === "ready" ? <ReleaseNotesModal /> : null}
      <AnimatePresence mode="wait">
        {showDailyReport && yesterdayReport ? (
          <DailyRoomReportModal
            key={`${roomId}-${yesterdayDate}`}
            report={yesterdayReport}
            onClose={() =>
              void saveSettings({
                lastDailyRoomReportSeen: {
                  ...settings?.lastDailyRoomReportSeen,
                  [roomId]: yesterdayDate,
                },
              })
            }
          />
        ) : null}
      </AnimatePresence>
      {bootstrapPhase === "ready" ? <UpdateModal /> : null}
      {isSafeMode && bootstrapPhase === "ready" ? (
        <SafeModeBanner
          issue={startupIssue}
          onRetry={retryBootstrap}
          onDismiss={dismissStartupIssue}
        />
      ) : null}
      <ModalHost>
        <OnboardingModal isOpen={isOnboardingOpen} onClose={() => setOnboardingOpen(false)} />
        <RecordingSaveDialog
          isOpen={recordingStatus.state === RecordingState.Saved}
          filePath={recordingStatus.result?.filePath}
          onClose={resetRecordingStatus}
        />
      </ModalHost>
      <ReconnectOverlay isVisible={roomState === RoomConnectionState.Reconnecting} />
    </>
  );
};
