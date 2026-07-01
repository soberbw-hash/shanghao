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

import workstationArt from "../../assets/scenes/workstation-chibi.webp";
import { avatarOptions } from "../../utils/profile";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import { AnimalSprite } from "./AnimalSprite";
import { DeskAnimalSprite } from "./DeskAnimalSprite";
import {
  characterPositions,
  isSeatZone,
  resolveMemberSceneZones,
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
  avatarId,
  shouldReduceMotion,
  awayIndex,
  awayCount,
  zone,
}: {
  member: RoomMember;
  avatarId: BuiltInAvatarId;
  shouldReduceMotion: boolean;
  awayIndex: number;
  awayCount: number;
  zone: SceneZoneId;
}) => {
  const status = memberStatus(member);
  const isSpeaking = status.tone === "speaking";
  const isReconnecting = status.tone === "reconnecting";
  const isOffline = status.tone === "offline";
  const basePosition = characterPositions[zone];
  const awayColumnCount = Math.min(3, Math.max(1, awayCount));
  const awayColumn = awayIndex % awayColumnCount;
  const awayRow = Math.floor(awayIndex / awayColumnCount);
  const position =
    zone === "restroomZone"
      ? {
          ...basePosition,
          left: 12 + (awayColumn - (awayColumnCount - 1) / 2) * 5,
          top: 65 + awayRow * 7,
          zIndex: basePosition.zIndex + awayIndex,
        }
      : basePosition;
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
      layout="position"
      initial={{ opacity: 0 }}
      animate={{
        opacity: isOffline ? 0.45 : 1,
      }}
      exit={{ opacity: 0 }}
      transition={{
        layout: shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 260, damping: 29, mass: 0.72 },
        opacity: { duration: shouldReduceMotion ? 0 : motionDuration.feedback },
      }}
      className="pointer-events-none absolute"
      style={{
        left: `${position.left}%`,
        top: `${position.top}%`,
        zIndex: position.zIndex,
      }}
    >
      <div className="-translate-x-1/2" data-gsap-character>
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
            {isSeatZone(zone) ? (
              <DeskAnimalSprite
                avatarId={avatarId}
                activity={member.activity ?? "idle"}
                isSpeaking={isSpeaking}
                isMoving={isMoving}
              />
            ) : (
              <AnimalSprite
                avatarId={avatarId}
                state="away"
                isMoving={isMoving}
              />
            )}
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
  const resolvedMemberZones = resolveMemberSceneZones(visibleMembers);
  const occupiedSeatIds = new Set<SceneZoneId>();
  visibleMembers.forEach((member) => {
    const zone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
    if (isSeatZone(zone)) occupiedSeatIds.add(zone);
  });
  const memberBySeat = new Map(
    visibleMembers
      .map((member) => [resolvedMemberZones.get(member.id), member] as const)
      .filter(
        (entry): entry is readonly [SceneZoneId, RoomMember] =>
          Boolean(entry[0] && isSeatZone(entry[0])),
      ),
  );
  const localMember = visibleMembers.find((member) => member.isLocal);
  const localZone = localMember ? resolvedMemberZones.get(localMember.id) : undefined;
  const awayMembers = visibleMembers.filter(
    (member) => resolvedMemberZones.get(member.id) === "restroomZone",
  );
  const memberMotionKey = visibleMembers
    .map((member) => `${member.id}:${resolvedMemberZones.get(member.id) ?? "gameDesk1"}`)
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
          ease: motionEase.feedback,
          stagger: 0.045,
          overwrite: true,
          force3D: true,
        },
      );
    }, islandRef);

    return () => context.revert();
  }, [memberMotionKey, shouldReduceMotion]);

  return (
    <div ref={islandRef} className="team-island relative h-full min-h-[420px] overflow-hidden" data-testid="team-island">
      <div className="team-island-stage absolute inset-0" aria-hidden="true">
        <div className="scene-service-zone scene-service-restroom">
          <span>离开一下</span>
        </div>
        {seatSlots.map((slot) => {
          const occupant = memberBySeat.get(slot.id);
          return (
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
              <div className="scene-workstation-art-frame">
                <img
                  src={workstationArt}
                  alt=""
                  className="scene-workstation-art"
                  draggable={false}
                  decoding="async"
                />
                <span className={`scene-workstation-screen ${occupant ? "online" : ""} ${occupant?.gameName ? "gaming" : ""}`}>
                  {occupant?.gameName ?? (occupant ? "上号" : "")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="absolute left-5 top-5 z-30 rounded-full border border-white/90 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#66778e] shadow-sm backdrop-blur-xl">
        {visibleMembers.length}/5 在线
      </div>

      <div className="pointer-events-none absolute inset-0 z-[48]">
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

      <div className="absolute inset-0 z-50">
        {sceneZones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`scene-zone-hotspot ${zone.kind === "seat" ? "seat" : "activity"} ${
              localZone === zone.id ? "current" : ""
            }`}
            style={{
              left: `${zone.left - zone.width / 2}%`,
              top: `${zone.top - zone.height / 2}%`,
              width: `${zone.width}%`,
              height: `${zone.height}%`,
            }}
            aria-label={`移动到${zone.label}`}
            disabled={
              zone.kind === "seat" &&
              occupiedSeatIds.has(zone.id) &&
              localZone !== zone.id
            }
            onClick={() => onZoneSelect?.(zone.id, zone.activity)}
          >
            <span>{zone.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence initial={false}>
        {visibleMembers.map((member) => {
          const zone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
          const awayIndex = awayMembers.findIndex((candidate) => candidate.id === member.id);
          return (
            <SceneCharacter
              key={member.id}
              member={member}
              avatarId={visibleAvatars.get(member.id) ?? "fox"}
              shouldReduceMotion={shouldReduceMotion}
              awayIndex={Math.max(0, awayIndex)}
              awayCount={awayMembers.length}
              zone={zone}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
