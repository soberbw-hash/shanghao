import type { RoomMember } from "@private-voice/shared";

import { MemberCard } from "./MemberCard";

export const MemberGrid = ({
  members,
  onVolumeChange,
}: {
  members: RoomMember[];
  onVolumeChange: (memberId: string, value: number) => void;
}) => (
  <div
    className="grid gap-3"
    style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
  >
    {members.map((member) => (
      <MemberCard key={member.id} member={member} onVolumeChange={onVolumeChange} />
    ))}
  </div>
);
