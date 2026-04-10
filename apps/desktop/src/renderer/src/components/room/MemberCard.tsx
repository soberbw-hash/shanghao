import { MicOff } from "lucide-react";

import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { MemberPresenceDot } from "./MemberPresenceDot";
import { MemberVolumePopover } from "./MemberVolumePopover";
import { HostBadge } from "./HostBadge";
import { SpeakingGlow } from "./SpeakingGlow";
import {
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";

export const MemberCard = ({
  member,
  onVolumeChange,
}: {
  member: RoomMember;
  onVolumeChange: (memberId: string, value: number) => void;
}) => (
  <div className="relative flex flex-col gap-4 rounded-[20px] border border-white/8 bg-white/[0.04] p-4">
    <SpeakingGlow isSpeaking={member.speakingState === MemberSpeakingState.Speaking} />
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <AvatarPlaceholder name={member.nickname} size="lg" />
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium text-white">{member.nickname}</span>
            <MemberPresenceDot presenceState={member.presenceState} />
          </div>
          <div className="text-sm text-white/50">
            {member.presenceState === MemberPresenceState.Online
              ? "Connected"
              : "Waiting for a friend"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member.isMuted ? <MicOff className="h-4 w-4 text-rose-200" /> : null}
        {member.isHost ? <HostBadge /> : null}
      </div>
    </div>
    <MemberVolumePopover
      value={member.volume}
      onChange={(value) => onVolumeChange(member.id, value)}
    />
  </div>
);
