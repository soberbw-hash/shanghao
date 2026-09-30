import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { RoomConnectionState } from "@private-voice/shared";

import { ModalHost } from "../components/layout/ModalHost";
import { ToastRegion } from "../components/layout/ToastRegion";
import { OnboardingModal } from "../components/status/OnboardingModal";
import { ReconnectOverlay } from "../components/status/ReconnectOverlay";
import { SafeModeBanner } from "../components/status/SafeModeBanner";
import { UpdateModal } from "../components/status/UpdateModal";
import { ReleaseNotesModal } from "../components/status/ReleaseNotesModal";
import { DailyRoomReportModal } from "../components/status/DailyRoomReportModal";
import { useAppStore } from "../store/appStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";
import { useDailyRoomReportStore } from "../store/dailyRoomReportStore";
import { retryActiveRoomConnection } from "../hooks/useRoomState";

const getYesterdayDate = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date(Date.now() - 86_400_000),
  );

export const SharedOverlays = () => {
  const isOnboardingOpen = useAppStore((state) => state.isOnboardingOpen);
  const setOnboardingOpen = useAppStore((state) => state.setOnboardingOpen);
  const roomState = useRoomStore((state) => state.room.connectionState);
  const isSafeMode = useAppStore((state) => state.isSafeMode);
  const startupIssue = useAppStore((state) => state.startupIssue);
  const dismissStartupIssue = useAppStore((state) => state.dismissStartupIssue);
  const retryBootstrap = useAppStore((state) => state.retryBootstrap);
  const bootstrapPhase = useAppStore((state) => state.bootstrapPhase);
  const currentPage = useAppStore((state) => state.currentPage);
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const updatePhase = useSettingsStore((state) => state.updateStatus.phase);
  const updateStatusVersion = useSettingsStore((state) => state.updateStatus.latestVersion);
  const updateStatusForced = useSettingsStore((state) => state.updateStatus.forceUpdate);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const roomId = useRoomStore((state) => (state.room.roomId === "side" ? "side" : "main"));
  const reports = useDailyRoomReportStore((state) => state.reports[roomId]);
  const reportsLoaded = useDailyRoomReportStore((state) => state.loaded[roomId]);
  const [welcomeQueueReady, setWelcomeQueueReady] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState(() =>
    window.localStorage.getItem("shanghao:dismissed-update-version"),
  );
  const roomEntryRef = useRef<string | undefined>(undefined);
  const [roomEntryKey, setRoomEntryKey] = useState<string | undefined>(undefined);
  const version = runtimeInfo?.version ?? "";
  const releasePending = Boolean(
    settings?.hasCompletedProfileSetup &&
    version &&
    version !== "0.0.0" &&
    settings.lastReleaseNotesVersionSeen !== version,
  );
  const updateDownloaded = updatePhase === "downloaded" || updatePhase === "ready_to_restart";
  const updateVersion = updateInfo?.latestVersion ?? updateStatusVersion ?? "";
  const updatePending = Boolean(
    (updateInfo?.hasUpdate || updatePhase === "downloading" || updateDownloaded) &&
    (updateInfo?.forceUpdate ||
      updateStatusForced ||
      updateDownloaded ||
      dismissedUpdateVersion !== updateVersion),
  );

  useEffect(() => {
    const syncDismissedVersion = () =>
      setDismissedUpdateVersion(window.localStorage.getItem("shanghao:dismissed-update-version"));
    window.addEventListener("shanghao:update-dismissed", syncDismissedVersion);
    return () => window.removeEventListener("shanghao:update-dismissed", syncDismissedVersion);
  }, []);

  useEffect(() => {
    if (releasePending) {
      setWelcomeQueueReady(false);
      return;
    }
    const timer = window.setTimeout(() => setWelcomeQueueReady(true), 420);
    return () => window.clearTimeout(timer);
  }, [releasePending]);

  // Arm the report once per room entry. A later transition from waiting for a
  // peer to connected must not be interpreted as a new room entry.
  useEffect(() => {
    if (currentPage !== "room") {
      roomEntryRef.current = undefined;
      setRoomEntryKey(undefined);
      return;
    }
    if (roomEntryRef.current === roomId) return;
    roomEntryRef.current = roomId;
    setRoomEntryKey(roomId);
  }, [currentPage, roomId]);

  const yesterdayDate = getYesterdayDate();
  const yesterdayReport = reports.find((report) => report.date === yesterdayDate);
  const showDailyReport = Boolean(
    bootstrapPhase === "ready" &&
    welcomeQueueReady &&
    !releasePending &&
    !updatePending &&
    currentPage === "room" &&
    roomEntryKey === roomId &&
    reportsLoaded &&
    yesterdayReport?.hadActivity &&
    settings?.lastDailyRoomReportSeen?.[roomId] !== yesterdayDate &&
    (roomState === RoomConnectionState.WaitingPeer ||
      roomState === RoomConnectionState.Connected ||
      roomState === RoomConnectionState.Degraded),
  );

  return (
    <>
      <ToastRegion />
      {bootstrapPhase === "ready" && !updatePending ? <ReleaseNotesModal /> : null}
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
      </ModalHost>
      <ReconnectOverlay
        isVisible={roomState === RoomConnectionState.Reconnecting}
        onRetry={() => retryActiveRoomConnection()}
        onLeave={() => window.dispatchEvent(new Event("shanghao:leave-reconnecting-room"))}
      />
    </>
  );
};
