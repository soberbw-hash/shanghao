import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings } from "@private-voice/shared";
import { AiVoiceMemorySettingsCard } from "../../src/renderer/src/components/settings/AiVoiceMemorySettingsCard";
import { MuteButton } from "../../src/renderer/src/components/audio/MuteButton";
import { RecordingMarkerCue } from "../../src/renderer/src/components/settings/RecordingMarkerCue";
import { UpdateModal } from "../../src/renderer/src/components/status/UpdateModal";
import { useSettingsStore } from "../../src/renderer/src/store/settingsStore";
import { SettingsPage } from "../../src/renderer/src/pages/SettingsPage";
import "../../src/renderer/src/styles/index.css";

const unconfigured = new URLSearchParams(window.location.search).has("unconfigured");
const readError = new URLSearchParams(window.location.search).has("read-error");
const showUpdate = new URLSearchParams(window.location.search).has("update");
const coldAiOpen = new URLSearchParams(window.location.search).has("cold-ai-open");
const fullSettings = new URLSearchParams(window.location.search).has("full-settings");
const waitForFixture = (name: string) =>
  coldAiOpen
    ? new Promise<void>((resolve) => window.addEventListener(name, () => resolve(), { once: true }))
    : Promise.resolve();
const snapshotReady = waitForFixture("fixture:ai-snapshot-ready");
const providersReady = waitForFixture("fixture:ai-providers-ready");
if (showUpdate)
  useSettingsStore.setState({
    updateStatus: {
      phase: "downloading",
      latestVersion: "9.0.0",
      message: "下载中",
      percent: 42,
      forceUpdate: true,
    },
  });
let providerReadFault = readError;
window.addEventListener("fixture:provider-recovered", () => {
  providerReadFault = false;
});
let saved = {
  configured: !unconfigured,
  hasApiKey: !unconfigured,
  model: "glm-4-flash-250414",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
};
window.desktopApi = {
  app: { writeLog: async () => {} },
  recording: {
    list: async () => ({ directory: "", items: [], totalBytes: 0, quotaBytes: 0 }),
  },
  ai: {
    getCustomProvider: async () => {
      await providersReady;
      if (providerReadFault) throw Error("custom_ai_config_unreadable");
      return saved;
    },
    saveCustomProvider: async (input: { baseUrl: string; model: string }) =>
      (saved = { ...saved, ...input }),
    getTranscriptionProvider: async () => {
      await providersReady;
      if (providerReadFault) throw Error("custom_asr_config_unreadable");
      return { cloudConfigured: !unconfigured, customConfigured: !unconfigured };
    },
    getSnapshot: async () => {
      await snapshotReady;
      return { models: [], scheduler: { gameActive: false }, checkedAt: "fixture" };
    },
    onStatus: () => () => {},
  },
} as unknown as typeof window.desktopApi;
const toast = () => {};
const Fixture = () => {
  const [settings, setSettings] = useState({
    aiOrganizerProvider: "custom",
    aiRoomAskProvider: "custom",
    aiTextModelPreset: "glm",
    aiTranscriptionProvider: coldAiOpen ? "cloud" : "custom",
    isAiAutoTranscribeEnabled: true,
    isAiAutoOrganizeEnabled: true,
    isAiAutoUploadEnabled: false,
    aiProcessingMode: "low_resource",
  } as AppSettings);
  const [muted, setMuted] = useState(false);
  return (
    <main className="room-page" style={{ padding: 20 }}>
      {showUpdate ? (
        <>
          <input aria-label="聊天消息" style={{ position: "fixed", bottom: 20, right: 20 }} />
          <UpdateModal />
        </>
      ) : null}
      <div style={{ position: "relative", height: 70 }}>
        <MuteButton isMuted={muted} onClick={() => setMuted(!muted)} />
        <RecordingMarkerCue
          markers={[
            {
              id: "fixture",
              offsetMs: 61000,
              label: "09:47 启动了英雄联盟",
              createdAt: "2026-10-18T01:47:00Z",
            },
          ]}
          currentTime={61}
          duration={800}
        />
      </div>
      <AiVoiceMemorySettingsCard
        settings={settings}
        onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
        pushToast={toast}
      />
    </main>
  );
};
if (fullSettings) {
  window.sessionStorage.setItem("shanghao.settings-section", "ai");
  const store = useSettingsStore.getState();
  useSettingsStore.setState({
    settings: { ...store.settings!, aiTranscriptionProvider: "local" },
    saveSettings: async (patch) => {
      const settings = { ...useSettingsStore.getState().settings!, ...patch };
      useSettingsStore.setState({ settings });
      return settings;
    },
  });
}
createRoot(document.getElementById("root")!).render(fullSettings ? <SettingsPage /> : <Fixture />);
