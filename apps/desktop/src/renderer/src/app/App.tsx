import { AppShell } from "../components/layout/AppShell";
import { RemoteAudioRenderer } from "../features/audio/RemoteAudioRenderer";
import { useAppBootstrap } from "../hooks/useAppBootstrap";
import { useGlobalMuteSync } from "../hooks/useGlobalMuteSync";
import { useLocalAudioTransport } from "../hooks/useLocalAudioTransport";
import { HomePage } from "../pages/HomePage";
import { RoomPage } from "../pages/RoomPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SharedOverlays } from "../pages/SharedOverlays";
import { RoomConnectionState } from "@private-voice/shared";
import { useAppStore } from "../store/appStore";
import { useRoomStore } from "../store/roomStore";
import { useSettingsStore } from "../store/settingsStore";

export const App = () => {
  useAppBootstrap();
  useGlobalMuteSync();
  useLocalAudioTransport();

  const currentPage = useAppStore((state) => state.currentPage);
  const isHydrating = useSettingsStore((state) => state.isHydrating);
  const roomConnectionState = useRoomStore((state) => state.room.connectionState);

  const resolvedPage =
    currentPage === "home" &&
    roomConnectionState !== RoomConnectionState.Idle &&
    roomConnectionState !== RoomConnectionState.Disconnected
      ? "room"
      : currentPage;

  return (
    <AppShell>
      {isHydrating ? null : (
        <>
          {resolvedPage === "home" ? <HomePage /> : null}
          {resolvedPage === "room" ? <RoomPage /> : null}
          {resolvedPage === "settings" ? <SettingsPage /> : null}
          <RemoteAudioRenderer />
        </>
      )}
      <SharedOverlays />
    </AppShell>
  );
};
