import { VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import {
  type BuiltInAvatarId,
  type MemberActivity,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";

import whiteOfficeRoom from "../../assets/scenes/white-office-room.png";
import { avatarOptions } from "../../utils/profile";
import { AnimalSprite } from "./AnimalSprite";
import { sceneZones, defaultMemberZones, characterPositions } from "../../features/voice-scene/sceneZones";
import { memberStatus } from "../../features/voice-scene/activityRules";

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
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${position.left}%`, top: `${position.top}%`, zIndex: position.zIndex }}
            >
              <div className="relative">
                <div
                  className={`room-character-sprite relative ${
                    isSpeaking ? "room-character-speaking" : ""
                  } ${member.isMuted ? "room-character-muted" : ""} ${member.isDeafened ? "room-character-deafened" : ""} ${isReconnecting ? "room-character-reconnecting" : ""}`}
                >
                  <AnimalSprite
                    avatarId={visibleAvatars.get(member.id) ?? "fox"}
                    state={isSpeaking ? "speaking" : member.activity ?? "idle"}
                  />
                  {member.isDeafened ? (
                    <span className="room-character-deafened-badge" aria-label="已关闭扬声器">
                      <VolumeX className="h-3 w-3" />
                    </span>
                  ) : null}
                </div>

                <div className={`room-character-label ${status.tone}`}>
                  {status.icon ? <status.icon className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} /> : null}
                  <span className="max-w-[100px] truncate">{status.label}</span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
