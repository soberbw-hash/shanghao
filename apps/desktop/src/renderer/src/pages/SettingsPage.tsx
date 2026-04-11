import { useEffect, useState } from "react";

import type { DiagnosticsSnapshot } from "@private-voice/shared";

import { Button } from "../components/base/Button";
import { PageContainer } from "../components/layout/PageContainer";
import { AppearanceSettingsCard } from "../components/settings/AppearanceSettingsCard";
import { AudioSettingsCard } from "../components/settings/AudioSettingsCard";
import { DiagnosticsSettingsCard } from "../components/settings/DiagnosticsSettingsCard";
import { NetworkSettingsCard } from "../components/settings/NetworkSettingsCard";
import { ProfileSettingsCard } from "../components/settings/ProfileSettingsCard";
import { SettingsPageHeader } from "../components/settings/SettingsPageHeader";
import { ShortcutSettingsCard } from "../components/settings/ShortcutSettingsCard";
import { StartupSplashPage } from "../components/status/StartupSplashPage";
import { useMicTest } from "../hooks/useMicTest";
import { useAppStore } from "../store/appStore";
import { useAudioStore } from "../store/audioStore";
import { useSettingsStore } from "../store/settingsStore";

export const SettingsPage = () => {
  const navigate = useAppStore((state) => state.navigate);
  const pushToast = useAppStore((state) => state.pushToast);
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const avatarDataUrl = useSettingsStore((state) => state.avatarDataUrl);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);
  const networkSnapshot = useSettingsStore((state) => state.networkSnapshot);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const pickAvatar = useSettingsStore((state) => state.pickAvatar);
  const clearAvatar = useSettingsStore((state) => state.clearAvatar);
  const refreshTailscale = useSettingsStore((state) => state.refreshTailscale);
  const refreshNetworkSnapshot = useSettingsStore((state) => state.refreshNetworkSnapshot);
  const resetSettings = useSettingsStore((state) => state.resetSettings);
  const inputDevices = useAudioStore((state) => state.inputDevices);
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>();

  const micTest = useMicTest({
    inputDeviceId: settings?.preferredInputDeviceId,
    outputDeviceId: settings?.preferredOutputDeviceId,
  });

  useEffect(() => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  }, []);

  if (!settings) {
    return <StartupSplashPage message="正在准备设置…" />;
  }

  const refreshDiagnostics = () => {
    void window.desktopApi.diagnostics.snapshot().then(setDiagnostics);
  };

  const handleMicTest = () => {
    void micTest.toggle().catch((error) => {
      pushToast({
        tone: "danger",
        title: "试音失败",
        description:
          error instanceof Error ? error.message : "当前无法启动试音，请检查麦克风权限。",
      });
    });
  };

  const handleRefreshNetwork = () => {
    void Promise.all([refreshTailscale(), refreshNetworkSnapshot()]).then(refreshDiagnostics);
  };

  const handleExportLogs = () => {
    void window.desktopApi.diagnostics.exportLogs().then((snapshot) => {
      setDiagnostics(snapshot);
      pushToast({
        tone: "success",
        title: "日志已导出",
        description: snapshot.lastExportPath || "请到导出位置查看。",
      });
    });
  };

  const handleExportBundle = () => {
    void window.desktopApi.diagnostics.exportBundle().then((snapshot) => {
      setDiagnostics(snapshot);
      pushToast({
        tone: "success",
        title: "诊断包已导出",
        description: snapshot.lastBundlePath || "请到导出位置查看。",
      });
    });
  };

  const handleOpenLogs = () => {
    void window.desktopApi.diagnostics.openLogsDirectory();
  };

  const handleReset = () => {
    void resetSettings().then(() => {
      refreshDiagnostics();
      pushToast({
        tone: "success",
        title: "设置已重置",
        description: "如果是启动问题，现在可以重新打开软件验证。",
      });
    });
  };

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
          isMicTesting={micTest.isTesting}
          micTestLevel={micTest.level}
          onToggleMicTest={handleMicTest}
          onChange={(patch) => void saveSettings(patch)}
        />
        <ShortcutSettingsCard settings={settings} onChange={(patch) => void saveSettings(patch)} />
        <NetworkSettingsCard
          settings={settings}
          tailscaleStatus={tailscaleStatus}
          networkSnapshot={networkSnapshot}
          runtimeInfo={runtimeInfo}
          onChange={(patch) => void saveSettings(patch)}
          onRefresh={handleRefreshNetwork}
        />
        <AppearanceSettingsCard settings={settings} onChange={(patch) => void saveSettings(patch)} />
        <DiagnosticsSettingsCard
          diagnostics={diagnostics}
          onOpenLogs={handleOpenLogs}
          onExportBundle={handleExportBundle}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={handleExportLogs}>
            导出日志
          </Button>
          <Button variant="danger" onClick={handleReset}>
            安全重置设置
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};
