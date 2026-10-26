import type { RoomMember } from "@private-voice/shared";
import { memberAvailabilityPresentation } from "../../features/room/memberAvailability";

export const MemberAvailabilityBubble = ({ member }: { member: RoomMember }) => {
  const status = memberAvailabilityPresentation(member);
  return status ? (
    <div className="scene-availability-bubble" role="status">
      <span aria-hidden="true">{status.icon}</span>
      {status.label}
    </div>
  ) : null;
};
