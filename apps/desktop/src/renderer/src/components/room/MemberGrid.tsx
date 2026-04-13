import type { RoomMember } from "@private-voice/shared";

import { MemberCard } from "./MemberCard";

export const MemberGrid = ({
  members,
  onVolumeChange,
}: {
  members: RoomMember[];
  onVolumeChange: (memberId: string, value: number) => void;
}) => (
  <div className="overflow-x-auto pb-1">
    <div className="grid min-w-[1120px] grid-cols-5 gap-3">
      {members.map((member) => (
        <MemberCard key={member.id} member={member} onVolumeChange={onVolumeChange} />
      ))}
    </div>
  </div>
);
