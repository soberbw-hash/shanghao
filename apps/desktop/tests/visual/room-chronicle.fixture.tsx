import { createRoot } from "react-dom/client";
import {
  MemberSpeakingState,
  RoomConnectionState,
  type RoomMember,
  type AccountSnapshot,
  type LocalChronicleEntry,
} from "@private-voice/shared";
import { RoomChatPanel } from "../../src/renderer/src/components/chat/RoomChatPanel";
import { RoomChronicleClient } from "../../src/renderer/src/features/room/RoomChronicleClient";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useAccountStore } from "../../src/renderer/src/store/accountStore";
import "../../src/renderer/src/styles/index.css";

const roomId = `room_${"a".repeat(32)}`;
window.desktopApi.roomMemory = {
  ...window.desktopApi.roomMemory,
  get: async () => ({
    roomId,
    revision: 1,
    manualText: "River是林小川",
    entries: [],
    autoEnabled: true,
  }),
};

const member = {
  id: "fixture-a",
  isLocal: true,
  displayName: "合成成员",
  nickname: "River",
  speakingState: MemberSpeakingState.Speaking,
} as RoomMember;
useRoomStore
  .getState()
  .setRoom({ roomId, members: [member], connectionState: RoomConnectionState.Connected });
const result = {
  audioParts: 0,
  decodedParts: 0,
  decodedSeconds: 0,
  bytes: 0,
  inputStillLive: false,
  reactionWrites: 0,
  exportRequests: 0,
};
let archive: LocalChronicleEntry[] = [];
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
  roomId,
  member.id,
  async (message) => {
    if (message.type === "chronicle_control") {
      if (message.action === "participate")
        state = { ...state, participants: message.enabled ? [member.id] : [] };
      client.receive({ type: "chronicle_state", roomId, state });
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
      client.receive({ type: "chronicle_state", roomId, state, chunkId: message.chunkId });
    }
  },
  (message) => useRoomStore.getState().setChronicle(message),
);
client.capability(true);
Object.assign(window, {
  chronicleFixture: {
    result,
    preview() {
      window.desktopApi.chronicleArchive = {
        export: async () => {
          result.exportRequests++;
          return { saved: true };
        },
        read: async () => archive,
        append: async (_roomId, entries) => {
          archive = [
            ...new Map(
              [
                ...archive,
                ...entries.map((entry) => ({
                  ...entry,
                  reaction: archive.find((old) => old.id === entry.id)?.reaction,
                })),
              ].map((entry) => [entry.id, entry]),
            ).values(),
          ];
          return archive;
        },
        react: async (_roomId, id, reaction) => {
          result.reactionWrites++;
          archive = archive.map((entry) => (entry.id === id ? { ...entry, reaction } : entry));
          return archive;
        },
      };
      useAccountStore.setState({
        snapshot: {
          status: "signed_in",
          configured: true,
          guestAllowed: false,
          profile: { userId: "synthetic-profile" },
        } as AccountSnapshot,
      });
      const friend = { ...member, id: "fixture-b", isLocal: false, nickname: "队友乙" };
      useRoomStore.getState().setRoom({
        roomId,
        members: [
          member,
          friend,
          { ...friend, id: "empty-slot-1", nickname: "空位", isEmptySlot: true },
        ],
        connectionState: RoomConnectionState.Connected,
      });
      state = {
        ...state,
        participants: [member.id],
        entries: [
          {
            id: "preview-one",
            at: Date.now() - 120000,
            text: "River（林小川）说这把稳了，队友乙提醒先看下一波。",
          },
          {
            id: "preview-two",
            at: Date.now(),
            text: "上一秒还在互相点菜，下一秒已经统一口径：这波算热身。技术有没有进步不好说，赛后发布会倒是提前练熟了。",
          },
        ],
      };
      client.capability(true);
      client.receive({
        type: "chronicle_state",
        roomId,
        state: { ...state, summaryIntervalMs: 120000 },
      });
    },
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
