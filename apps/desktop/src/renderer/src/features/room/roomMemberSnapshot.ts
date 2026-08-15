import { MemberPresenceState, MemberSpeakingState, type RoomMember } from "@private-voice/shared";

/** Normalizes a server room snapshot while preserving locally cached avatar payloads. */
export const normalizeRoomMembers = (
  members: RoomMember[],
  localPeerId: string,
  getCachedAvatar: (peerId: string) => string | undefined,
): RoomMember[] =>
  members.map((member) => ({
    ...member,
    avatarDataUrl: getCachedAvatar(member.id) ?? member.avatarDataUrl,
    presenceState:
      member.id === localPeerId || member.presenceState === MemberPresenceState.Online
        ? MemberPresenceState.Online
        : member.presenceState,
    speakingState: member.isMuted
      ? MemberSpeakingState.Muted
      : (member.speakingState ?? MemberSpeakingState.Silent),
  }));

export const collectActivePeerIds = (members: RoomMember[], localPeerId: string): Set<string> =>
  new Set(
    members
      .filter((member) => member.id !== localPeerId && !member.isEmptySlot)
      .map((member) => member.id),
  );
