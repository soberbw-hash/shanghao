import { MemberJoinState, type RoomMember } from "@private-voice/shared";

/** Empty seats and peers still connecting do not trigger automatic recording. */
export const hasRecordingCompanion = (members: readonly RoomMember[]): boolean =>
  members.some(
    (member) =>
      !member.isLocal &&
      !member.isEmptySlot &&
      (member.joinState === undefined || member.joinState === MemberJoinState.Joined),
  );
