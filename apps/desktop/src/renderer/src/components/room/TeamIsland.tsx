import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";

import {
  type BuiltInAvatarId,
  type MemberActivity,
  type RoomMember,
  type SceneZoneId,
} from "@private-voice/shared";

import { avatarOptions } from "../../utils/profile";
import { AnimalSprite } from "./AnimalSprite";
import {
  activityZones,
  characterPositions,
  defaultMemberZones,
  isSeatZone,
  sceneZones,
  seatSlots,
} from "../../features/voice-scene/sceneZones";
import { memberStatus } from "../../features/voice-scene/activityRules";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

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

const SceneCharacter = ({
  member,
  index,
  avatarId,
  shouldReduceMotion,
}: {
  member: RoomMember;
  index: number;
  avatarId: BuiltInAvatarId;
  shouldReduceMotion: boolean;
}) => {
  const status = memberStatus(member);
  const isSpeaking = status.tone === "speaking";
  const isReconnecting = status.tone === "reconnecting";
  const isOffline = status.tone === "offline";
  const zone = member.sceneZone ?? defaultMemberZones[index] ?? "gameDesk1";
  const position = characterPositions[zone];
  const lastZoneRef = useRef<SceneZoneId>(zone);
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    if (shouldReduceMotion) {
      lastZoneRef.current = zone;
      setIsMoving(false);
      return;
    }

    if (lastZoneRef.current === zone) return;

    lastZoneRef.current = zone;
    setIsMoving(true);
    const timer = window.setTimeout(() => setIsMoving(false), 760);
    return () => window.clearTimeout(timer);
  }, [shouldReduceMotion, zone]);

  return (
    <motion.div
      key={member.id}
      initial={{ opacity: 0 }}
      animate={{
        left: `${position.left}%`,
        top: `${position.top}%`,
        opacity: isOffline ? 0.45 : 1,
      }}
      exit={{ opacity: 0 }}
      transition={{
        left: { duration: shouldReduceMotion ? 0 : 0.72, ease: [0.22, 1, 0.36, 1] },
        top: { duration: shouldReduceMotion ? 0 : 0.72, ease: [0.22, 1, 0.36, 1] },
        opacity: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
      }}
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ zIndex: position.zIndex }}
    >
      <div className="relative" data-gsap-character>
        <div
          className="scene-character-anchor relative"
          style={{
            "--character-scale": position.scale,
            "--label-offset-y": `${position.labelOffsetY ?? 0}px`,
          } as CSSProperties & Record<string, string | number>}
        >
          <div
            className={`room-character-sprite relative ${
              isSpeaking ? "room-character-speaking" : ""
            } ${member.isMuted ? "room-character-muted" : ""} ${member.isDeafened ? "room-character-deafened" : ""} ${isReconnecting ? "room-character-reconnecting" : ""}`}
          >
            <AnimalSprite
              avatarId={avatarId}
              state={isSpeaking ? "speaking" : member.activity ?? "idle"}
              isMoving={isMoving}
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
      </div>
    </motion.div>
  );
};

export const TeamIsland = ({
  members,
  onZoneSelect,
  reduceMotion = false,
}: {
  members: RoomMember[];
  onZoneSelect?: (zone: SceneZoneId, activity: MemberActivity) => void;
  reduceMotion?: boolean;
}) => {
  const islandRef = useRef<HTMLDivElement>(null);
  const visibleMembers = members.filter((member) => !member.isEmptySlot).slice(0, 5);
  const visibleAvatars = assignVisibleAvatars(visibleMembers);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);
  const occupiedSeatIds = new Set<SceneZoneId>();
  visibleMembers.forEach((member, index) => {
    const zone = member.sceneZone ?? defaultMemberZones[index] ?? "gameDesk1";
    occupiedSeatIds.add(isSeatZone(zone) ? zone : defaultMemberZones[index] ?? "gameDesk1");
  });
  const memberMotionKey = visibleMembers
    .map((member) => `${member.id}:${member.sceneZone ?? "gameDesk1"}`)
    .join("|");

  useLayoutEffect(() => {
    if (shouldReduceMotion || !islandRef.current || !memberMotionKey) return;

    const context = gsap.context(() => {
      gsap.fromTo(
        "[data-gsap-character]",
        { autoAlpha: 0, y: 12, scale: 0.94, rotation: -1.5 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          rotation: 0,
          duration: 0.34,
          ease: "back.out(1.45)",
          stagger: 0.045,
          overwrite: true,
        },
      );
    }, islandRef);

    return () => context.revert();
  }, [memberMotionKey, shouldReduceMotion]);

  return (
    <div ref={islandRef} className="team-island relative h-full min-h-[420px] overflow-hidden" data-testid="team-island">
      <div className="team-island-stage absolute inset-0" aria-hidden="true">
        <div className="scene-room-title">上号办公室</div>
        <div className="scene-service-zone scene-service-coffee">
          <span>茶水间</span>
          <i className="scene-coffee-machine" />
          <i className="scene-cups" />
        </div>
        <div className="scene-service-zone scene-service-fitness">
          <span>运动区</span>
          <i className="scene-treadmill" />
          <i className="scene-dumbbell" />
        </div>
        <div className="scene-service-zone scene-service-restroom">
          <span>离开一下</span>
          <i className="scene-restroom-door" />
        </div>
        {seatSlots.map((slot) => (
          <div
            key={slot.id}
            className="scene-workstation"
            style={{
              left: `${slot.left}%`,
              top: `${slot.top}%`,
              zIndex: characterPositions[slot.id].zIndex - 3,
            }}
          >
            <div className="scene-desk-shadow" />
            <div className="scene-desk-top">
              <span className="scene-monitor" />
              <span className="scene-keyboard" />
              <span className="scene-speaker left" />
              <span className="scene-speaker right" />
            </div>
            <div className="scene-chair" />
          </div>
        ))}
      </div>
      <div className="absolute left-5 top-5 z-30 rounded-full border border-white/90 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#66778e] shadow-sm backdrop-blur-xl">
        {visibleMembers.length}/5 在线
      </div>

      <div className="pointer-events-none absolute inset-0 z-[8]">
        {seatSlots.map((slot) => {
          const occupied = occupiedSeatIds.has(slot.id);
          return (
            <div
              key={slot.id}
              className={`scene-seat-marker ${occupied ? "occupied" : "empty"}`}
              style={{
                left: `${slot.left}%`,
                top: `${slot.top}%`,
              }}
              aria-hidden="true"
            >
              <span>{slot.shortLabel}</span>
            </div>
          );
        })}
      </div>

      <div className="absolute inset-0 z-10">
        {sceneZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`scene-zone-hotspot ${zone.kind === "seat" ? "seat" : "activity"}`}
            style={{
              left: `${zone.left - zone.width / 2}%`,
              top: `${zone.top - zone.height / 2}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
            }}
            aria-label={`移动到${zone.label}`}
            onClick={() => onZoneSelect?.(zone.id, zone.activity)}
          >
            {activityZones.some((candidate) => candidate.id === zone.id) ? (
              <span>{zone.label}</span>
            ) : null}
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {visibleMembers.map((member, index) => (
          <SceneCharacter
            key={member.id}
            member={member}
            index={index}
            avatarId={visibleAvatars.get(member.id) ?? "fox"}
            shouldReduceMotion={shouldReduceMotion}
          />
        ))}
      </AnimatePresence>
    </div>
  );
};
