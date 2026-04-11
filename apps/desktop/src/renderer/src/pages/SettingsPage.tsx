import { useEffect, useState } from "react";

import type { DiagnosticsSnapshot } from "@private-voice/shared";

import { PageContainer } from "../components/layout/PageContainer";
import { AppearanceSettingsCard } from "../components/settings/AppearanceSettingsCard";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";
import { DiagnosticsSettingsCard } from "../components/settings/DiagnosticsSettingsCard";
import { ExportLogsButton } from "../components/settings/ExportLogsButton";
import { NetworkSettingsCard } from "../components/settings/NetworkSettingsCard";
import { ProfileSettingsCard } from "../components/settings/ProfileSettingsCard";
import { ResetSettingsButton } from "../components/settings/ResetSettingsButton";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { ShortcutSettingsCard } from "../components/settings/ShortcutSettingsCard";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";

export const SettingsPage = () => {
  const navigate = useAppStore((state) => state.navigate);
  const settings = useSettingsStore((state) => state.settings);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const pickAvatar = useSettingsStore((state) => state.pickAvatar);
  const clearAvatar = useSettingsStore((state) => state.clearAvatar);
  const refreshTailscale = useSettingsStore((state) => state.refreshTailscale);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();

  useEffect(() => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  }, []);

  if (!settings) {
    return <StartupSplashPage message="正在准备设置…" />;
  }

  return (
    <PageContainer className="overflow-y-auto">
      <SettingsPageHeader onBack={() => navigate("home")} />
      <div className="space-y-4">
        <ProfileSettingsCard
          settings={settings}
          avatarDataUrl={avatarDataUrl}
          onPickAvatar={() => void pickAvatar()}
          onClearAvatar={() => void clearAvatar()}
          onChange={(patch) => void saveSettings(patch)}
        />
        <AudioSettingsCard
          settings={settings}
          inputDevices={inputDevices}
          outputDevices={outputDevices}
          onChange={(patch) => void saveSettings(patch)}
        />
        <ShortcutSettingsCard settings={settings} onChange={(patch) => void saveSettings(patch)} />
        <NetworkSettingsCard
          tailscaleStatus={tailscaleStatus}
          onRefresh={() => void refreshTailscale()}
        />
        <AppearanceSettingsCard
          settings={settings}
          onChange={(patch) => void saveSettings(patch)}
        />
        <DiagnosticsSettingsCard diagnostics={diagnostics} />
        <div className="flex flex-wrap items-center gap-3">
          <ExportLogsButton
            onClick={() => {
              void window.desktopApi.diagnostics.exportLogs().then(setDiagnostics);
            }}
          />
          <ResetSettingsButton onClick={() => void resetSettings()} />
        </div>
      </div>
    </PageContainer>
  );
};
