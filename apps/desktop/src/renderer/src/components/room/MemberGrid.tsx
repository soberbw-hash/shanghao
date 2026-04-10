import type { RoomMember } from "@private-voice/shared";

import { MemberCard } from "./MemberCard";

export const MemberGrid = ({
  members,
  onVolumeChange,
}: {
  members: RoomMember[];
  onVolumeChange: (memberId: string, value: number) => void;
}) => (
  <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-2">
    {members.map((member) => (
      <MemberCard key={member.id} member={member} onVolumeChange={onVolumeChange} />
    ))}
  </div>
);
