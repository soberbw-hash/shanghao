import type { RoomMember } from "@private-voice/shared";

export const sceneMemberKey = (member: Pick<RoomMember, "id" | "isLocal">): string =>
  member.isLocal ? "local-member" : member.id;
