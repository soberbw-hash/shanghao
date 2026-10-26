import { createRoot, type Root } from "react-dom/client";
import { AnimatePresence } from "framer-motion";
import {
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";
import { useRoomStore } from "../../src/renderer/src/store/roomStore";
import { useAudioStore } from "../../src/renderer/src/store/audioStore";
import { RoomMemberEventCoordinator } from "../../src/renderer/src/features/room/RoomMemberEventCoordinator";
import { MemberAvailabilityControls } from "../../src/renderer/src/components/chat/MemberAvailabilityControls";
import { ChatPanelHeader } from "../../src/renderer/src/components/chat/ChatPanelHeader";
import { SceneCharacter } from "../../src/renderer/src/components/room/SceneCharacter";
import { usePhoneModeSync } from "../../src/renderer/src/hooks/usePhoneModeSync";
import "../../src/renderer/src/styles/index.css";

const initial: RoomMember[] = ["local", "friend-a", "friend-b"].map((id, index) => ({
  id,
  nickname: index ? `朋友 ${index}` : "我",
  isLocal: !index,
  isHost: !index,
  isMuted: false,
  sceneZone: `gameDesk${index + 1}` as SceneZoneId,
  presenceState: MemberPresenceState.Online,
  speakingState: MemberSpeakingState.Silent,
  volume: 1,
  connectionQuality: "excellent",
  joinedAt: "2026-10-18T00:00:00Z",
}));
useRoomStore.getState().setMembers(initial);
const events = new RoomMemberEventCoordinator({
  localPeerId: "local",
  onMembers: (members) => useRoomStore.getState().setMembers(members),
  onCollection: () => {},
  onKnock: () => {},
  onReaction: () => {},
  onQuickMessage: () => {},
});
events.setMembers(initial);
const Fixture = () => {
  usePhoneModeSync();
  const snapshot = useRoomStore((state) => state.room.members);
  const members = snapshot.filter((member) => !member.isEmptySlot);
  const muted = useAudioStore((state) => state.isMuted);
  const phoneModeActive = useAudioStore((state) => state.phoneModeActive);
  return (
    <main className="room-page" style={{ padding: 16, width: 760 }}>
      <ChatPanelHeader
        mood="idle"
        isAsking={false}
        roomAiPanel={null}
        onOpenAssistant={() => {}}
        onOpenQuickSettings={() => {}}
        presenceControls={
          <MemberAvailabilityControls
            canSend
            send={async (targetPeerId, emoji) => {
              events.handleReaction({
                type: "scene_reaction",
                roomId: "main",
                peerId: "local",
                targetPeerId,
                emoji,
                createdAt: new Date().toISOString(),
              });
            }}
          />
        }
      >
        <span>快捷消息区域</span>
      </ChatPanelHeader>
      <output id="fixture-muted">{muted ? "muted" : "open"}</output>
      <output id="fixture-status">
        {JSON.stringify(
          members.map(({ id, sceneZone, availabilityStatus }) => ({
            id,
            sceneZone,
            availabilityStatus,
          })),
        )}
      </output>
      <button
        id="fixture-rerender"
        onClick={() => {
          events.setMembers(events.currentMembers.map((member) => ({ ...member })));
          useRoomStore.getState().setMembers(events.currentMembers);
        }}
      >
        刷新成员快照
      </button>
      <section
        style={{
          position: "relative",
          width: 720,
          height: 380,
          containerType: "size",
          marginTop: 24,
        }}
      >
        <AnimatePresence>
          {members.map((member, index) => (
            <SceneCharacter
              key={member.id}
              member={member.isLocal ? { ...member, callModeActive: phoneModeActive } : member}
              avatarId={index === 1 ? "cat" : "fox"}
              shouldReduceMotion={false}
              awayIndex={0}
              awayCount={1}
              zone={member.sceneZone ?? "gameDesk1"}
              arrivalIndex={index}
              isWelcoming={false}
              isScreenSharing={false}
            />
          ))}
        </AnimatePresence>
      </section>
    </main>
  );
};
const runtime = globalThis as typeof globalThis & { memberFixtureRoot?: Root };
runtime.memberFixtureRoot ??= createRoot(document.getElementById("root")!);
runtime.memberFixtureRoot.render(<Fixture />);
