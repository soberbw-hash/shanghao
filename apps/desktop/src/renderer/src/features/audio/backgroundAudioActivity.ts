import {
  MemberSpeakingState,
  PushToTalkState,
  RoomConnectionState,
  type RoomMember,
} from "@private-voice/shared";

/** Reuses the room's voice activity; never opens or records another microphone. */
export function backgroundAudioActivity(
  room: { connectionState: RoomConnectionState; members: RoomMember[] },
  audio: {
    isMuted: boolean;
    isDeafened: boolean;
    phoneModeActive: boolean;
    listenOnly: boolean;
    isPushToTalkEnabled: boolean;
    pushToTalkState: PushToTalkState;
  },
) {
  const inRoom =
    room.connectionState === RoomConnectionState.Connected &&
    room.members.some((member) => member.isLocal);
  const speaking =
    inRoom &&
    !audio.phoneModeActive &&
    room.members.some(
      (member) =>
        !member.isEmptySlot &&
        member.speakingState === MemberSpeakingState.Speaking &&
        (member.isLocal
          ? !audio.isMuted &&
            !audio.isDeafened &&
            !audio.listenOnly &&
            (!audio.isPushToTalkEnabled || audio.pushToTalkState === PushToTalkState.Pressed)
          : !audio.isDeafened && !member.isMuted && (member.volume ?? 1) > 0),
    );
  return { inRoom, speaking };
}
