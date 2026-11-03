import { createRoot } from "react-dom/client";
import { MemberSpeakingState, RoomConnectionState, type RoomMember } from "@private-voice/shared";
import { RoomChatPanel } from "../../src/renderer/src/components/chat/RoomChatPanel";
import { RoomChronicleClient } from "../../src/renderer/src/features/room/RoomChronicleClient";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import "../../src/renderer/src/styles/index.css";

const member = {
  id: "fixture-a",
  isLocal: true,
  displayName: "合成成员",
  nickname: "合成成员",
  speakingState: MemberSpeakingState.Speaking,
} as RoomMember;
useRoomStore
  .getState()
  .setRoom({ roomId: "main", members: [member], connectionState: RoomConnectionState.Connected });
const result = {
  audioParts: 0,
  decodedParts: 0,
  decodedSeconds: 0,
  bytes: 0,
  inputStillLive: false,
};
const context = new AudioContext();
const source = context.createOscillator();
const output = context.createMediaStreamDestination();
source.frequency.value = 220;
source.connect(output);
source.start();
useRoomStore.getState().setLocalStream(output.stream);
let state = {
  sessionId: "fixture-session",
  participants: [member.id],
  entries: [] as { id: string; at: number; text: string }[],
};
const client = new RoomChronicleClient(
  "main",
  member.id,
  async (message) => {
    if (message.type === "chronicle_control") {
      if (message.action === "participate")
        state = { ...state, participants: message.enabled ? [member.id] : [] };
      client.receive({ type: "chronicle_state", roomId: "main", state });
    } else if (message.type === "chronicle_audio") {
      result.audioParts++;
      const audio = Uint8Array.from(atob(message.data), (value) => value.charCodeAt(0));
      result.bytes = audio.length;
      const decoded = await context.decodeAudioData(audio.buffer);
      result.decodedSeconds = decoded.duration;
      result.decodedParts++;
      state = {
        ...state,
        entries: [
          {
            id: "synthetic-note",
            at: message.startedAt,
            text: "合成测试纪事：只验证录制、界面和同步，不代表真实云端识别效果。",
          },
        ],
      };
      client.receive({ type: "chronicle_state", roomId: "main", state, chunkId: message.chunkId });
    }
  },
  (message) => useRoomStore.getState().setChronicle(message),
);
client.capability(true);
Object.assign(window, {
  chronicleFixture: {
    result,
    supported: (enabled: boolean) => client.capability(enabled),
    async close() {
      client.dispose();
      result.inputStillLive = output.stream.getAudioTracks()[0]?.readyState === "live";
      source.stop();
      output.stream.getTracks().forEach((track) => track.stop());
      await context.close();
    },
  },
});
createRoot(document.getElementById("root")!).render(
  <main className="room-page" style={{ height: "100vh", background: "#eaf3fc", padding: 12 }}>
    <RoomChatPanel
      chronicle={client}
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
  </main>,
);
