import { createRoot } from "react-dom/client";
import { StrictMode, useState } from "react";
import { MemberSpeakingState, RoomConnectionState, type RoomMember } from "@private-voice/shared";
import { RoomChatPanel } from "../../src/renderer/src/components/chat/RoomChatPanel";
import { VoiceReplayShortcutSettings } from "../../src/renderer/src/components/settings/VoiceReplayShortcutSettings";
import { RoomReplayClient } from "../../src/renderer/src/features/room/RoomReplayClient";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import "../../src/renderer/src/styles/index.css";

const local = {
  id: "one",
  isLocal: true,
  nickname: "合成成员",
  displayName: "合成成员",
  speakingState: MemberSpeakingState.Speaking,
} as RoomMember;
useRoomStore
  .getState()
  .setRoom({ roomId: "main", members: [local], connectionState: RoomConnectionState.Connected });
const context = new AudioContext(),
  source = context.createOscillator(),
  output = context.createMediaStreamDestination();
source.frequency.value = 250;
source.connect(output);
source.start();
useRoomStore.getState().setLocalStream(output.stream);
let state:
  | { sessionId: string; epoch: number; members: string[]; approved: string[]; enabled: boolean }
  | undefined;
const client = new RoomReplayClient(
  "main",
  local.id,
  async (message) => {
    if (message.type !== "replay_control") throw Error("unexpected_audio_upload");
    if (message.action === "start")
      state = {
        sessionId: "test-generation",
        epoch: 1,
        members: [local.id],
        approved: [local.id],
        enabled: true,
      };
    if (message.action === "revoke" && state) state = { ...state, approved: [], enabled: false };
    if (message.action === "approve" && state)
      state = { ...state, approved: [local.id], enabled: true };
    if (message.action === "stop") state = undefined;
    client.receive({ type: "replay_state", roomId: "main", state });
  },
  (message) => useRoomStore.getState().setReplay(message),
);
client.capability(true);
Object.assign(window, {
  replayFixture: {
    inputLive: () => output.stream.getAudioTracks()[0]!.readyState === "live",
    async close() {
      client.dispose();
      source.stop();
      await context.close();
    },
  },
});
function Fixture() {
  const [settings, setSettings] = useState(false);
  return (
    <main
      className="room-page"
      style={{
        padding: 16,
        background: "#eaf3fc",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button id="fixture-toggle-settings" onClick={() => setSettings((value) => !value)}>
        切换设置
      </button>
      {settings && <VoiceReplayShortcutSettings />}
      <RoomChatPanel
        replay={client}
        canSend
        reduceMotion={false}
        sendChatMessage={async () => {}}
        recallChatMessage={async () => {}}
        sendQuickMessage={async () => {}}
        sendConfiguredQuickMessage={async () => {}}
        onOpenQuickMessageSettings={() => {}}
        onOpenRoomAi={() => {}}
        onCloseRoomAi={() => {}}
        isRoomAskOpen={false}
        roomAiPanel={null}
        assistantMood="idle"
        onAssistantMoodChange={() => {}}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
