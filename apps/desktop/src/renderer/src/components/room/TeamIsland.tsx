import { Headphones, MicOff, RotateCw, VolumeX, WifiOff } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import {
  MemberPresenceState,
  MemberSpeakingState,
  type BuiltInAvatarId,
  type MemberActivity,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";

import whiteOfficeRoom from "../../assets/scenes/white-office-room.png";
import { avatarOptions } from "../../utils/profile";
import { AnimalSprite } from "./AnimalSprite";

const sceneZones: Array<{
  id: SceneZoneId;
  label: string;
  activity: MemberActivity;
  left: number;
  top: number;
  width: number;
  height: number;
}> = [
  { id: "coffeeBar", label: "茶水间", activity: "drinking", left: 22, top: 18, width: 26, height: 18 },
  { id: "fitnessZone", label: "运动区", activity: "fitness", left: 12, top: 66, width: 22, height: 31 },
  { id: "restroomZone", label: "洗手间", activity: "restroom", left: 84, top: 18, width: 16, height: 24 },
  { id: "gameDesk1", label: "游戏位 1", activity: "gaming", left: 37, top: 43, width: 17, height: 20 },
  { id: "gameDesk2", label: "游戏位 2", activity: "gaming", left: 55, top: 29, width: 16, height: 18 },
  { id: "gameDesk3", label: "游戏位 3", activity: "gaming", left: 70, top: 50, width: 17, height: 20 },
  { id: "gameDesk4", label: "游戏位 4", activity: "gaming", left: 47, top: 73, width: 17, height: 20 },
  { id: "gameDesk5", label: "游戏位 5", activity: "gaming", left: 72, top: 76, width: 17, height: 20 },
];

const defaultMemberZones: SceneZoneId[] = [
  "gameDesk1",
  "gameDesk2",
  "gameDesk3",
  "gameDesk4",
  "gameDesk5",
];

const characterPositions: Record<SceneZoneId, { left: number; top: number }> = {
  coffeeBar: { left: 28, top: 23 },
  fitnessZone: { left: 15, top: 69 },
  restroomZone: { left: 84, top: 24 },
  gameDesk1: { left: 37, top: 47 },
  gameDesk2: { left: 55, top: 34 },
  gameDesk3: { left: 70, top: 54 },
  gameDesk4: { left: 47, top: 77 },
  gameDesk5: { left: 72, top: 79 },
};

const activityLabels: Record<MemberActivity, string> = {
  idle: "等待中",
  gaming: "游戏中",
  drinking: "喝水中",
  fitness: "运动中",
  restroom: "离开一下",
};

const memberStatus = (member: RoomMember) => {
  if (member.presenceState === MemberPresenceState.Reconnecting) {
    return { label: "正在回来", tone: "reconnecting" as const, icon: RotateCw };
  }
  if (member.presenceState === MemberPresenceState.Offline) {
    return { label: "暂时离开", tone: "offline" as const, icon: WifiOff };
  }
  if (member.isDeafened) {
    return { label: "已关闭扬声器", tone: "deafened" as const, icon: VolumeX };
  }
  if (member.isMuted) {
    return { label: "静音中", tone: "muted" as const, icon: MicOff };
  }
  if (member.speakingState === MemberSpeakingState.Speaking) {
    return { label: "正在说话", tone: "speaking" as const, icon: Headphones };
  }
  return {
    label: member.gameName || activityLabels[member.activity ?? "idle"],
    tone: "online" as const,
  };
};

const assignVisibleAvatars = (members: RoomMember[]): Map<string, BuiltInAvatarId> => {
  const result = new Map<string, BuiltInAvatarId>();
  const available = avatarOptions.map((avatar) => avatar.id);
  for (const member of members) {
    const preferred = member.avatarId;
    const selected =
      preferred && available.includes(preferred)
        ? preferred
        : available[0] ?? preferred ?? "fox";
    result.set(member.id, selected);
    const index = available.indexOf(selected);
    if (index >= 0) available.splice(index, 1);
  }
  return result;
};

export const TeamIsland = ({
  members,
  onZoneSelect,
}: {
  members: RoomMember[];
  onZoneSelect?: (zone: SceneZoneId, activity: MemberActivity) => void;
}) => {
  const visibleMembers = members.filter((member) => !member.isEmptySlot).slice(0, 5);
  const visibleAvatars = assignVisibleAvatars(visibleMembers);

  return (
    <div className="team-island relative h-full min-h-[420px] overflow-hidden" data-testid="team-island">
      <img
        src={whiteOfficeRoom}
        alt=""
        className="team-island-background absolute inset-0 h-full w-full"
        draggable={false}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.02),rgba(240,246,255,.1))]" />
      <div className="absolute left-5 top-5 z-30 rounded-full border border-white/90 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#66778e] shadow-sm backdrop-blur-xl">
        {visibleMembers.length}/5 在线
      </div>

      <div className="absolute inset-0 z-10">
        {sceneZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className="scene-zone-hotspot"
            style={{
              left: `${zone.left - zone.width / 2}%`,
              top: `${zone.top - zone.height / 2}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
            }}
            aria-label={`移动到${zone.label}`}
            onClick={() => onZoneSelect?.(zone.id, zone.activity)}
          />
        ))}
      </div>

      <AnimatePresence initial={false}>
        {visibleMembers.map((member, index) => {
          const status = memberStatus(member);
          const isSpeaking = status.tone === "speaking";
          const isReconnecting = status.tone === "reconnecting";
          const isOffline = status.tone === "offline";
          const zone = member.sceneZone ?? defaultMemberZones[index] ?? "gameDesk1";
          const position = characterPositions[zone];

          return (
            <motion.div
              key={member.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: isOffline ? 0.45 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${position.left}%`, top: `${position.top}%` }}
            >
              <div className="relative">
                <div
                  className={`room-character-sprite relative ${
                    isSpeaking ? "room-character-speaking" : ""
                  } ${member.isMuted ? "room-character-muted" : ""} ${isReconnecting ? "room-character-reconnecting" : ""}`}
                >
                  <AnimalSprite
                    avatarId={visibleAvatars.get(member.id) ?? "fox"}
                    state={isSpeaking ? "speaking" : member.activity ?? "idle"}
                  />
                  {member.isDeafened ? (
                    <span className="room-character-deafened" aria-label="已关闭扬声器">
                      <VolumeX className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </div>

                <div className={`room-character-label absolute left-1/2 top-full -translate-x-1/2 mt-1 ${status.tone}`}>
                  {status.icon ? <status.icon className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} /> : null}
                  <span className="max-w-[82px] truncate">{status.label}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
