import { RecordingState, RoomConnectionState } from "@private-voice/shared";

import { ModalHost } from "../components/layout/ModalHost";
import { ToastRegion } from "../components/layout/ToastRegion";
import { OnboardingModal } from "../components/status/OnboardingModal";
import { ReconnectOverlay } from "../components/status/ReconnectOverlay";
import { RecordingSaveDialog } from "../components/status/RecordingSaveDialog";
import { SafeModeBanner } from "../components/status/SafeModeBanner";
import { useAppStore } from "../store/appStore";
import { useRecordingStore } from "../store/recordingStore";
import { useRoomStore } from "../store/roomStore";

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

  return (
    <>
      <ToastRegion />
      {isSafeMode && bootstrapPhase === "ready" ? (
        <SafeModeBanner
          issue={startupIssue}
          onRetry={retryBootstrap}
          onDismiss={dismissStartupIssue}
        />
      ) : null}
      <ModalHost>
        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={() => setOnboardingOpen(false)}
        />
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
