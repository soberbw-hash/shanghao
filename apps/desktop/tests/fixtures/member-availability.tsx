import { createRoot } from "react-dom/client";
import { ChatPanelHeader } from "../../src/renderer/src/components/chat/ChatPanelHeader";
import { MemberAvailabilityControls } from "../../src/renderer/src/components/chat/MemberAvailabilityControls";
import { useAudioStore } from "../../src/renderer/src/store/audioStore";
import "../../src/renderer/src/styles/index.css";

useAudioStore.setState({ isMuted: false });
document.addEventListener("fixture-manual-mute", () => {
  useAudioStore.setState({ isMuted: true, isDeafened: false, isManuallyMuted: true });
});
let sends = 0;
createRoot(document.getElementById("root")!).render(
  <main className="room-page" style={{ padding: 16, background: "#e9f3fd" }}>
    <ChatPanelHeader
      mood="idle"
      isAsking={false}
      roomAiPanel={null}
      onOpenAssistant={() => {}}
      onOpenQuickSettings={() => {}}
      presenceControls={
        <MemberAvailabilityControls
          canSend
          send={async () => {
            document.documentElement.dataset.sendCount = String(++sends);
            document.documentElement.dataset.muted = String(useAudioStore.getState().isMuted);
            document.documentElement.dataset.deafened = String(useAudioStore.getState().isDeafened);
            document.documentElement.dataset.manualMute = String(
              useAudioStore.getState().isManuallyMuted,
            );
          }}
        />
      }
    >
      <div>上号 / 开麦 / 等我</div>
    </ChatPanelHeader>
  </main>,
);
