import { MicOff, X } from "lucide-react";
import { motion } from "framer-motion";

import { MemberSpeakingState, type RoomMember } from "@private-voice/shared";

import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { getAvatarSrc } from "../../utils/profile";

export const FloatingBuddyBar = ({
  members,
  isMuted,
  onClose,
}: {
  members: RoomMember[];
  isMuted: boolean;
  onClose: () => void;
}) => (
  <motion.div
    drag
    dragMomentum={false}
    initial={{ opacity: 0, scale: 0.96, y: 10 }}
    animate={{ opacity: 1, scale: 1, y: 0 }}
    className="no-drag fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 cursor-grab items-center gap-2 rounded-full border border-white/90 bg-white/72 px-3 py-2 shadow-[0_18px_50px_rgba(45,65,100,.18)] backdrop-blur-2xl active:cursor-grabbing"
  >
    {members.filter((member) => !member.isEmptySlot).map((member) => (
      <div
        key={member.id}
        className={`rounded-full p-0.5 ${
          member.speakingState === MemberSpeakingState.Speaking
            ? "bg-[#75a1ff] shadow-[0_0_18px_rgba(79,125,247,.5)]"
            : "bg-white"
        }`}
      >
        <AvatarPlaceholder
          name={member.nickname}
          src={getAvatarSrc(member.avatarId)}
          size="sm"
          className="h-8 w-8 rounded-full"
        />
      </div>
    ))}
    <span className={`h-2.5 w-2.5 rounded-full ${isMuted ? "bg-[#f5a524]" : "bg-[#18b669]"}`} />
    {isMuted ? <MicOff className="h-3.5 w-3.5 text-[#8a96a7]" /> : null}
    <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-full text-[#8a96a7] hover:bg-white">
      <X className="h-3.5 w-3.5" />
    </button>
  </motion.div>
);
