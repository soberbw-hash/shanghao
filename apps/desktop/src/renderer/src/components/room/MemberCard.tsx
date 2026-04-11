import { useState } from "react";
import { ChevronDown, MicOff } from "lucide-react";
import { motion } from "framer-motion";

import {
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";

import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { HostBadge } from "./HostBadge";
import { MemberPresenceDot } from "./MemberPresenceDot";
import { MemberVolumePopover } from "./MemberVolumePopover";
import { SpeakingGlow } from "./SpeakingGlow";
import { getMemberPresenceLabel } from "../../utils/labels";

export const MemberCard = ({
  member,
  onVolumeChange,
}: {
  member: RoomMember;
  onVolumeChange: (memberId: string, value: number) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (member.isEmptySlot) {
    return (
      <div className="flex h-[80px] items-center gap-3 rounded-[18px] border border-dashed border-[#D6DEE8] bg-[#F8FAFC] px-4">
        <AvatarPlaceholder name="空位" size="md" className="bg-white text-[#98A2B3]" />
        <div>
          <div className="text-sm font-medium text-[#111827]">空位</div>
          <div className="text-xs text-[#98A2B3]">等朋友上号</div>
        </div>
      </div>
    );
  }

  const isSpeaking = member.speakingState === MemberSpeakingState.Speaking;

  return (
    <button
      type="button"
      onClick={() => setIsExpanded((value) => !value)}
      className="relative flex w-full flex-col gap-3 rounded-[18px] border border-[#E7ECF2] bg-white px-4 py-3 text-left shadow-[0_8px_20px_rgba(17,24,39,0.04)] transition hover:border-[#C7D7EB]"
    >
      <SpeakingGlow isSpeaking={isSpeaking} />
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <AvatarPlaceholder
            name={member.nickname}
            src={member.avatarDataUrl}
            size="md"
          />
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white">
            <MemberPresenceDot presenceState={member.presenceState} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-[#111827]">
              {member.nickname}
            </span>
            {member.isHost ? <HostBadge /> : null}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-[#667085]">
            <span>{getMemberPresenceLabel(member.presenceState)}</span>
            {member.isMuted ? (
              <>
                <span className="text-[#D0D5DD]">·</span>
                <MicOff className="h-3.5 w-3.5 text-[#EF4444]" />
                <span>静音</span>
              </>
            ) : null}
            {isSpeaking ? (
              <>
                <span className="text-[#D0D5DD]">·</span>
                <span className="text-[#2B84E9]">说话中</span>
              </>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[#98A2B3] transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </div>
      {isExpanded ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          <MemberVolumePopover
            value={member.volume}
            onChange={(value) => onVolumeChange(member.id, value)}
          />
        </motion.div>
      ) : null}
    </button>
  );
};
