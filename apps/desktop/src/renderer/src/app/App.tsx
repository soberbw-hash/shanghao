import { useEffect } from "react";
import { RoomConnectionState } from "@private-voice/shared";

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

export const App = () => {
  useAppBootstrap();
  useGlobalMuteSync();
  useLocalAudioTransport();

  const currentPage = useAppStore((state) => state.currentPage);
  const isHydrating = useSettingsStore((state) => state.isHydrating);
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const roomConnectionState = useRoomStore((state) => state.room.connectionState);
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

  const resolvedPage =
    currentPage === "home" &&
    roomConnectionState !== RoomConnectionState.Idle &&
    roomConnectionState !== RoomConnectionState.Disconnected &&
    roomConnectionState !== RoomConnectionState.Failed
      ? "room"
      : currentPage;

  const shouldShowProfileSetup = Boolean(
    settings && !settings.hasCompletedProfileSetup,
  );

  return (
    <AppShell>
      {isHydrating ? null : (
        <>
          {shouldShowProfileSetup ? <ProfileSetupPage /> : null}
          {!shouldShowProfileSetup && resolvedPage === "home" ? <HomePage /> : null}
          {!shouldShowProfileSetup && resolvedPage === "room" ? <RoomPage /> : null}
          {!shouldShowProfileSetup && resolvedPage === "settings" ? <SettingsPage /> : null}
          <RemoteAudioRenderer />
        </>
      )}
      <SharedOverlays />
    </AppShell>
  );
};
