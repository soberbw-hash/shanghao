import { MicOff, RotateCw, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import {
  MemberPresenceState,
  MemberSpeakingState,
  type RoomMember,
} from "@private-voice/shared";

import whiteOfficeRoom from "../../assets/scenes/white-office-room.png";
import { getAvatarSrc } from "../../utils/profile";
import { AvatarPlaceholder } from "../base/AvatarPlaceholder";

const positions = [
  "left-[34%] top-[43%]",
  "left-[53%] top-[25%]",
  "left-[72%] top-[48%]",
  "left-[46%] top-[74%]",
  "left-[73%] top-[77%]",
];

const memberStatus = (member: RoomMember) => {
  if (member.presenceState === MemberPresenceState.Reconnecting) {
    return { label: "正在回来", tone: "reconnecting" as const, icon: RotateCw };
  }
  if (member.presenceState === MemberPresenceState.Offline) {
    return { label: "暂时离开", tone: "offline" as const, icon: WifiOff };
  }
  if (member.isMuted) {
    return { label: "静音", tone: "muted" as const, icon: MicOff };
  }
  if (member.speakingState === MemberSpeakingState.Speaking) {
    return { label: "语音中", tone: "speaking" as const };
  }
  return { label: member.isLocal ? "是你" : "在线", tone: "online" as const };
};

export const TeamIsland = ({ members }: { members: RoomMember[] }) => {
  const visibleMembers = members.filter((member) => !member.isEmptySlot).slice(0, 5);

  return (
    <div className="team-island relative h-full min-h-[420px] overflow-hidden" data-testid="team-island">
      <img
        src={whiteOfficeRoom}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.03),rgba(240,246,255,.16))]" />
      <div className="absolute left-5 top-5 rounded-full border border-white/90 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#66778e] shadow-sm backdrop-blur-xl">
        {visibleMembers.length}/5 在线
      </div>

      <AnimatePresence initial={false}>
        {visibleMembers.map((member, index) => {
          const status = memberStatus(member);
          const isSpeaking = status.tone === "speaking";
          const isReconnecting = status.tone === "reconnecting";
          const isOffline = status.tone === "offline";
          const StatusIcon = status.icon;

          return (
            <motion.div
              key={member.id}
              initial={{ opacity: 0, scale: 0.82, y: 10 }}
              animate={{ opacity: isOffline ? 0.48 : 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 8 }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              className={`absolute z-10 -translate-x-1/2 -translate-y-1/2 ${positions[index] ?? positions[0]}`}
            >
              <div className="flex flex-col items-center">
                <motion.div
                  animate={isSpeaking ? { scale: [1, 1.035, 1] } : { scale: 1 }}
                  transition={{ duration: 1.15, repeat: isSpeaking ? Infinity : 0, ease: "easeInOut" }}
                  className={`room-character relative rounded-[24px] p-1.5 ${
                    isSpeaking ? "room-character-speaking" : ""
                  } ${member.isMuted ? "room-character-muted" : ""} ${isReconnecting ? "room-character-reconnecting" : ""}`}
                >
                  <AvatarPlaceholder
                    name={member.nickname}
                    src={getAvatarSrc(member.avatarId)}
                    size="lg"
                    className="h-[70px] w-[70px] rounded-[19px]"
                  />
                  {member.isLocal ? (
                    <span className="absolute -left-1 -top-1 rounded-full border-2 border-white bg-[#1f2937] px-1.5 py-0.5 text-[9px] font-bold text-white">
                      你
                    </span>
                  ) : null}
                </motion.div>

                <div className={`room-character-label mt-1.5 ${status.tone}`}>
                  {StatusIcon ? <StatusIcon className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} /> : null}
                  <span className="max-w-[82px] truncate">{member.nickname}</span>
                  <span className="opacity-55">·</span>
                  <span>{status.label}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
