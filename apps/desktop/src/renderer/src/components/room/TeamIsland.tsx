import { MicOff } from "lucide-react";
import { motion } from "framer-motion";

import {
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";

import { AvatarPlaceholder } from "../base/AvatarPlaceholder";
import { getAvatarSrc } from "../../utils/profile";

const positions = [
  "left-[10%] top-[46%]",
  "left-[31%] top-[18%]",
  "left-[50%] top-[53%]",
  "right-[28%] top-[18%]",
  "right-[9%] top-[46%]",
];

export const TeamIsland = ({ members }: { members: RoomMember[] }) => (
  <div className="team-island relative min-h-[410px] overflow-hidden" data-testid="team-island">
    <div className="team-island-haze" />
    <div className="team-island-platform">
      <div className="team-island-platform-inner">
        <span />
        <span />
        <span />
      </div>
    </div>

    {members.slice(0, 5).map((member, index) => {
      const isEmpty = Boolean(member.isEmptySlot);
      const isSpeaking = member.speakingState === MemberSpeakingState.Speaking;
      const isReconnecting = member.presenceState === MemberPresenceState.Reconnecting;
      return (
        <motion.div
          key={member.id}
          initial={{ opacity: 0, scale: 0.82, y: 10 }}
          animate={{ opacity: isEmpty ? 0.42 : 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 ${positions[index] ?? positions[0]}`}
        >
          <motion.div
            animate={isSpeaking ? { y: [0, -5, 0] } : { y: [0, -2, 0] }}
            transition={{ duration: isSpeaking ? 1.2 : 4.8, repeat: Infinity, ease: "easeInOut" }}
            className="flex flex-col items-center"
          >
            <div
              className={`relative rounded-[26px] p-2 transition-all duration-300 ${
                isSpeaking
                  ? "bg-white shadow-[0_0_0_6px_rgba(79,125,247,.12),0_18px_44px_rgba(79,125,247,.24)]"
                  : "bg-white/70 shadow-[0_12px_30px_rgba(44,65,105,.12)]"
              } ${member.isMuted ? "opacity-55 grayscale-[.35]" : ""}`}
            >
              <AvatarPlaceholder
                name={member.nickname}
                src={isEmpty ? undefined : getAvatarSrc(member.avatarId)}
                size="lg"
                className="h-[76px] w-[76px] rounded-[21px]"
              />
              {member.isMuted && !isEmpty ? (
                <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full border-2 border-white bg-[#f5f7fa] text-[#7b8798]">
                  <MicOff className="h-3.5 w-3.5" />
                </span>
              ) : null}
              {isReconnecting ? (
                <span className="absolute -right-1 -top-1 h-3.5 w-3.5 animate-pulse rounded-full border-2 border-white bg-[#f5a524]" />
              ) : null}
            </div>
            <div className="mt-2 max-w-[120px] truncate rounded-full border border-white/90 bg-white/75 px-3 py-1 text-xs font-semibold text-[#43536a] shadow-sm backdrop-blur-xl">
              {isEmpty ? "等一个朋友" : member.nickname}
            </div>
          </motion.div>
        </motion.div>
      );
    })}
  </div>
);
