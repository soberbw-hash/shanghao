import { MemberPresenceState, type RoomMember } from "@private-voice/shared";

import { sceneMemberKey } from "../../components/room/sceneMemberKey";

/**
 * Removes only the stale half of a reconnect overlap.
 * Two fully-online peers are always kept, even when a migrated legacy profile id collides.
 */
export const selectVisibleSceneMembers = (members: RoomMember[]): RoomMember[] => {
  const visible: RoomMember[] = [];
  const indexByStableIdentity = new Map<string, number>();

  for (const member of members) {
    if (member.isEmptySlot) continue;
    const key = sceneMemberKey(member);
    const existingIndex = indexByStableIdentity.get(key);
    if (existingIndex === undefined) {
      indexByStableIdentity.set(key, visible.length);
      visible.push(member);
      continue;
    }

    const existing = visible[existingIndex];
    if (!existing) continue;
    const isReconnectOverlap =
      existing.id === member.id ||
      existing.presenceState !== MemberPresenceState.Online ||
      member.presenceState !== MemberPresenceState.Online;

    if (isReconnectOverlap) {
      const next =
        existing.presenceState !== MemberPresenceState.Online &&
        member.presenceState === MemberPresenceState.Online
          ? member
          : member.joinedAt >= existing.joinedAt
            ? member
            : existing;
      visible[existingIndex] = next;
      continue;
    }

    visible.push(member);
  }

  return visible.slice(0, 5);
};
