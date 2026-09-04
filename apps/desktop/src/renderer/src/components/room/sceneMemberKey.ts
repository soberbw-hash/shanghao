import type { RoomMember } from "@private-voice/shared";

export const sceneMemberKey = (
  member: Pick<RoomMember, "id" | "isLocal" | "userId" | "profileId">,
): string =>
  member.isLocal ? "local-member" : `remote:${member.userId || member.profileId || member.id}`;
