import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings } from "@private-voice/shared";
import { AiVoiceMemorySettingsCard } from "../../src/renderer/src/components/settings/AiVoiceMemorySettingsCard";
import { MuteButton } from "../../src/renderer/src/components/audio/MuteButton";
import { RecordingMarkerCue } from "../../src/renderer/src/components/settings/RecordingMarkerCue";
import "../../src/renderer/src/styles/index.css";

const saved = {
  configured: true,
  hasApiKey: true,
  model: "glm-4-flash-250414",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
};
window.desktopApi = {
  app: { writeLog: async () => {} },
  ai: {
    getCustomProvider: async () => saved,
    saveCustomProvider: async () => saved,
    getTranscriptionProvider: async () => ({ cloudConfigured: true, customConfigured: true }),
    getSnapshot: async () => ({
      models: [],
      scheduler: { gameActive: false },
      checkedAt: "fixture",
    }),
    onStatus: () => () => {},
  },
} as unknown as typeof window.desktopApi;
const toast = () => {};
const Fixture = () => {
  const [settings, setSettings] = useState({
    aiOrganizerProvider: "custom",
    aiRoomAskProvider: "custom",
    aiTextModelPreset: "glm",
    aiTranscriptionProvider: "custom",
  } as AppSettings);
  const [muted, setMuted] = useState(false);
  return (
    <main className="room-page" style={{ padding: 20 }}>
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
createRoot(document.getElementById("root")!).render(<Fixture />);
