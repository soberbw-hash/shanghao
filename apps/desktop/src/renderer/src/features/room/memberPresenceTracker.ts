import type { RoomMember } from "@private-voice/shared";

/** Membership deltas belong to one room connection, including its reconnects. */
export class MemberPresenceTracker {
  private previousIds = new Set<string>();

  collect(members: RoomMember[]): { joined: RoomMember[]; left: string[] } {
    const remoteMembers = members.filter((member) => !member.isEmptySlot && !member.isLocal);
    const nextIds = new Set(remoteMembers.map((member) => member.id));
    const joined = remoteMembers.filter((member) => !this.previousIds.has(member.id));
    const left = [...this.previousIds].filter((memberId) => !nextIds.has(memberId));
    this.previousIds = nextIds;
    return { joined, left };
  }
}
