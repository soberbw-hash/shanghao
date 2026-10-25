import { createRoot } from "react-dom/client";
import type { DesktopApi } from "@private-voice/shared";
import { DiagnosticsSettingsCard } from "../../src/renderer/src/components/settings/DiagnosticsSettingsCard";
import "../../src/renderer/src/styles/index.css";

const action = (value: string) => {
  document.documentElement.dataset.action = value;
};
window.desktopApi = {
  ai: {
    getRuntimeStatus: async () => {
      action("unexpected-runtime-probe");
      return {};
    },
  },
} as unknown as DesktopApi;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24, background: "#e9f3fd", minHeight: "100vh" }}>
    <DiagnosticsSettingsCard
      roomActive={false}
      outputDeviceCount={0}
      remotePeerCount={0}
      webrtcReadyPeerCount={0}
      onOpenLogs={() => action("logs")}
      onExportBundle={() => action("export")}
      onCopySummary={() => action("copy")}
      onRefreshHealth={() => action("refresh")}
      onOpenAudioSettings={() => action("audio")}
      onOpenAiSettings={() => action("ai")}
      onOpenHome={() => action("home")}
      onOpenRoom={() => action("room")}
      onRefreshWindows={() => action("permissions")}
      onRepairFirewall={() => action("repair")}
      isRepairingFirewall={false}
      isRefreshingHealth={false}
      isRefreshingWindows={false}
    />
  </main>,
);
