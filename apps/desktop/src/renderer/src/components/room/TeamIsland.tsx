import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Fish, Gamepad2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";

import {
  APPLE_MOTION_EASE,
  APPLE_MOTION_SPRING,
  type BuiltInAvatarId,
  type MemberActivity,
  type RoomMember,
  type SceneReaction,
  type SceneZoneId,
} from "@private-voice/shared";

import { getStableAvatarId } from "../../utils/profile";
import { motionDuration, motionEase } from "../../features/motion/motionSystem";
import { AnimalSprite } from "./AnimalSprite";
import { DeskAnimalSprite, type DeskAnimalIdleAction } from "./DeskAnimalSprite";
import { WorkstationArt } from "./WorkstationArt";
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
  return new Map(
    members.map((member) => [member.id, getStableAvatarId(member.id, member.avatarId)]),
  );
};

const getLatencyTone = (latencyMs?: number) => {
  if (typeof latencyMs !== "number") return "unknown";
  if (latencyMs < 80) return "good";
  if (latencyMs < 150) return "fair";
  if (latencyMs < 250) return "slow";
  return "poor";
};

const stableMotionPhase = (memberId: string): number => {
  let hash = 0;
  for (let index = 0; index < memberId.length; index += 1) {
    hash = (hash * 31 + memberId.charCodeAt(index)) >>> 0;
  }
  return -((hash % 2400) / 1000);
};

const stableMotionSeed = (memberId: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < memberId.length; index += 1) {
    hash ^= memberId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const IDLE_ACTIONS: DeskAnimalIdleAction[] = ["look", "stretch", "sip"];

const SceneCharacter = ({
  member,
  avatarId,
  shouldReduceMotion,
  awayIndex,
  awayCount,
  zone,
  reaction,
  onReact,
  onVolumeChange,
}: {
  member: RoomMember;
  avatarId: BuiltInAvatarId;
  shouldReduceMotion: boolean;
  awayIndex: number;
  awayCount: number;
  zone: SceneZoneId;
  reaction?: SceneReaction;
  onReact?: (targetPeerId: string, emoji: SceneReaction["emoji"]) => void;
  onVolumeChange?: (memberId: string, volume: number) => void;
}) => {
  const status = memberStatus(member);
  const [visibleReaction, setVisibleReaction] = useState<SceneReaction>();
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

  useEffect(() => {
    if (!reaction) {
      setVisibleReaction(undefined);
      return;
    }
    setVisibleReaction(reaction);
    const elapsed = Date.now() - Date.parse(reaction.createdAt);
    const timeout = window.setTimeout(
      () => setVisibleReaction((current) => (current?.id === reaction.id ? undefined : current)),
      Math.max(200, 4_000 - elapsed),
    );
    return () => window.clearTimeout(timeout);
  }, [reaction]);
  const lastZoneRef = useRef<SceneZoneId>(zone);
  const [isMoving, setIsMoving] = useState(false);
  const [idleAction, setIdleAction] = useState<DeskAnimalIdleAction>("none");

  useEffect(() => {
    if (shouldReduceMotion) {
      lastZoneRef.current = zone;
      setIsMoving(false);
      return;
    }

    if (lastZoneRef.current === zone) return;

    lastZoneRef.current = zone;
    setIsMoving(true);
    const timer = window.setTimeout(
      () => setIsMoving(false),
      Math.round(motionDuration.scene * 1_000 + 100),
    );
    return () => window.clearTimeout(timer);
  }, [shouldReduceMotion, zone]);

  useEffect(() => {
    if (
      shouldReduceMotion ||
      isMoving ||
      isSpeaking ||
      member.activity === "gaming" ||
      zone === "restroomZone"
    ) {
      setIdleAction("none");
      return;
    }

    const seed = stableMotionSeed(member.id);
    let actionIndex = seed % IDLE_ACTIONS.length;
    let actionTimer: number | undefined;
    let resetTimer: number | undefined;
    const schedule = (delay: number) => {
      actionTimer = window.setTimeout(() => {
        const nextAction = IDLE_ACTIONS[actionIndex % IDLE_ACTIONS.length] ?? "look";
        actionIndex += 1;
        setIdleAction(nextAction);
        resetTimer = window.setTimeout(
          () => {
            setIdleAction("none");
            schedule(8_800 + ((seed + actionIndex * 997) % 4_800));
          },
          nextAction === "stretch" ? 2_100 : 1_700,
        );
      }, delay);
    };

    schedule(4_800 + (seed % 4_600));
    return () => {
      if (actionTimer !== undefined) window.clearTimeout(actionTimer);
      if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    };
  }, [isMoving, isSpeaking, member.activity, member.id, shouldReduceMotion, zone]);

  return (
    <motion.div
      key={member.id}
      layout="position"
      initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 16, scale: 0.92 }}
      animate={{
        opacity: isOffline ? 0.45 : 1,
        y: 0,
        scale: 1,
      }}
      exit={{
        opacity: 0,
        x: -72,
        y: 36,
        scale: 0.82,
      }}
      transition={{
        layout: shouldReduceMotion ? { duration: 0 } : { type: "spring", ...APPLE_MOTION_SPRING },
        opacity: { duration: shouldReduceMotion ? 0 : motionDuration.feedback },
        y: shouldReduceMotion ? { duration: 0 } : { type: "spring", ...APPLE_MOTION_SPRING },
        scale: shouldReduceMotion ? { duration: 0 } : { type: "spring", ...APPLE_MOTION_SPRING },
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
          style={
            {
              "--character-scale": position.scale,
              "--label-offset-y": `${position.labelOffsetY ?? 0}px`,
              "--character-motion-delay": `${stableMotionPhase(member.id)}s`,
            } as CSSProperties & Record<string, string | number>
          }
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
                isMuted={member.isMuted}
                idleAction={idleAction}
              />
            ) : (
              <AnimalSprite avatarId={avatarId} state="away" isMoving={isMoving} />
            )}
            {member.isDeafened ? (
              <span className="room-character-deafened-badge" aria-label="已关闭扬声器">
                <VolumeX className="h-3 w-3" />
              </span>
            ) : null}
          </div>

          {zone === "restroomZone" ? (
            <div className="room-character-away-label" title={member.nickname}>
              {member.nickname}
            </div>
          ) : (
            <div className={`room-character-label ${status.tone}`}>
              <span className="room-character-identity">
                <strong className="room-character-nickname" title={member.nickname}>
                  {member.nickname}
                </strong>
                <span aria-hidden="true">·</span>
                <span className={`room-character-latency ${getLatencyTone(member.latencyMs)}`}>
                  {typeof member.latencyMs === "number" ? Math.round(member.latencyMs) : "--"} ms
                </span>
              </span>
              <span className="room-character-state">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={`${status.tone}-${status.label}`}
                    className="inline-flex min-w-0 items-center gap-1"
                    initial={shouldReduceMotion ? false : { opacity: 0, y: 2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? undefined : { opacity: 0, y: -2 }}
                    transition={{
                      duration: shouldReduceMotion ? 0 : motionDuration.color,
                      ease: APPLE_MOTION_EASE,
                    }}
                  >
                    {status.icon ? (
                      <status.icon className={`h-3 w-3 ${isReconnecting ? "animate-spin" : ""}`} />
                    ) : null}
                    <span className="max-w-[118px] truncate">{status.label}</span>
                  </motion.span>
                </AnimatePresence>
              </span>
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {visibleReaction ? (
              <motion.div
                key={visibleReaction.id}
                className="scene-character-reaction"
                initial={{ opacity: 0, y: 8, scale: 0.72, rotate: -8 }}
                animate={{ opacity: 1, y: -6, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, y: -24, scale: 0.82, rotate: 7 }}
                transition={
                  shouldReduceMotion ? { duration: 0 } : { type: "spring", ...APPLE_MOTION_SPRING }
                }
              >
                {visibleReaction.emoji}
              </motion.div>
            ) : null}
          </AnimatePresence>
          {!member.isLocal ? (
            <div className="scene-reaction-picker" aria-label={`给${member.nickname}发送表情`}>
              {(["👍", "🔥", "😂", "❤️"] as const).map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onReact?.(member.id, emoji)}
                  aria-label={`发送${emoji}`}
                >
                  {emoji}
                </button>
              ))}
              <label
                className="scene-member-volume"
                title={`${member.nickname} 音量 ${Math.round(member.volume * 100)}%`}
              >
                <span>音量</span>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={member.volume}
                  onChange={(event) => onVolumeChange?.(member.id, Number(event.target.value))}
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
};

export const TeamIsland = ({
  members,
  onZoneSelect,
  onReact,
  onVolumeChange,
  reactions = [],
  knockPulse = 0,
  reduceMotion = false,
}: {
  members: RoomMember[];
  onZoneSelect?: (zone: SceneZoneId, activity: MemberActivity) => void;
  onReact?: (targetPeerId: string, emoji: SceneReaction["emoji"]) => void;
  onVolumeChange?: (memberId: string, volume: number) => void;
  reactions?: SceneReaction[];
  knockPulse?: number;
  reduceMotion?: boolean;
}) => {
  const islandRef = useRef<HTMLDivElement>(null);
  const visibleMembers = members.filter((member) => !member.isEmptySlot).slice(0, 5);
  const visibleAvatars = assignVisibleAvatars(visibleMembers);
  const shouldReduceMotion = usePrefersReducedMotion(reduceMotion);
  const [ambient, setAmbient] = useState<"day" | "evening" | "night">("day");
  const [hoveredZone, setHoveredZone] = useState<SceneZoneId>();
  const resolvedMemberZones = resolveMemberSceneZones(visibleMembers);
  const occupiedSeatIds = new Set<SceneZoneId>();
  visibleMembers.forEach((member) => {
    const zone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
    if (isSeatZone(zone)) occupiedSeatIds.add(zone);
  });
  const memberBySeat = new Map(
    visibleMembers
      .map((member) => [resolvedMemberZones.get(member.id), member] as const)
      .filter((entry): entry is readonly [SceneZoneId, RoomMember] =>
        Boolean(entry[0] && isSeatZone(entry[0])),
      ),
  );
  const localMember = visibleMembers.find((member) => member.isLocal);
  const localZone = localMember ? resolvedMemberZones.get(localMember.id) : undefined;
  const awayMembers = visibleMembers.filter(
    (member) => resolvedMemberZones.get(member.id) === "restroomZone",
  );
  useEffect(() => {
    const updateAmbient = () => {
      const hour = new Date().getHours();
      setAmbient(hour >= 22 || hour < 6 ? "night" : hour >= 18 ? "evening" : "day");
    };
    updateAmbient();
    const timer = window.setInterval(updateAmbient, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    if (shouldReduceMotion || !islandRef.current || knockPulse <= 0) return;
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { overwrite: true } });
      timeline
        .fromTo(
          "[data-knock-wave]",
          { autoAlpha: 0.48, scale: 0.48 },
          { autoAlpha: 0, scale: 2.4, duration: 0.52, ease: motionEase.spatial },
          0,
        )
        .to(
          ".scene-workstation.is-occupied .scene-workstation-art-frame",
          {
            keyframes: [
              { y: -3, rotation: -0.7, duration: 0.055 },
              { y: 1.5, rotation: 0.8, duration: 0.065 },
              { y: -1, rotation: -0.28, duration: 0.06 },
              { y: 0, rotation: 0, duration: 0.12 },
            ],
            transformOrigin: "50% 82%",
            ease: motionEase.feedback,
            stagger: { each: 0.022, from: "center" },
          },
          0.015,
        )
        .to(
          ".scene-workstation.is-occupied .scene-workstation-screen",
          {
            keyframes: [
              { scale: 1.055, filter: "brightness(1.28)", duration: 0.07 },
              { scale: 0.985, filter: "brightness(1.06)", duration: 0.08 },
              { scale: 1, filter: "brightness(1)", duration: 0.12 },
            ],
            transformOrigin: "50% 60%",
            stagger: { each: 0.022, from: "center" },
          },
          0.025,
        )
        .to(
          ".scene-workstation.is-occupied .scene-desk-shadow",
          {
            keyframes: [
              { scaleX: 1.16, opacity: 0.58, duration: 0.08 },
              { scaleX: 1, opacity: 1, duration: 0.18 },
            ],
            stagger: { each: 0.022, from: "center" },
          },
          0.03,
        )
        .to(
          "[data-gsap-character] .desk-animal",
          {
            keyframes: [
              { y: -5, rotation: -1.8, scale: 1.025, duration: 0.07 },
              { y: 1, rotation: 1.2, scale: 0.995, duration: 0.08 },
              { y: 0, rotation: 0, scale: 1, duration: 0.16 },
            ],
            transformOrigin: "50% 100%",
            stagger: { each: 0.028, from: "center" },
          },
          0.055,
        )
        .set(
          ".scene-workstation-art-frame, .scene-workstation-screen, .scene-desk-shadow, [data-gsap-character] .desk-animal",
          { clearProps: "transform,filter,opacity" },
        );
    }, islandRef);
    return () => context.revert();
  }, [knockPulse, shouldReduceMotion]);

  return (
    <div
      ref={islandRef}
      className={`team-island ambient-${ambient} relative h-full min-h-[420px] overflow-hidden`}
      data-testid="team-island"
    >
      <span className="scene-knock-wave" data-knock-wave aria-hidden="true" />
      <div className="team-island-stage absolute inset-0" aria-hidden="true">
        <div className="scene-service-zone scene-service-restroom">
          <span>离开一下</span>
        </div>
        {seatSlots.map((slot) => {
          const occupant = memberBySeat.get(slot.id);
          const occupantTone = occupant ? memberStatus(occupant).tone : undefined;
          return (
            <div
              key={slot.id}
              className={`scene-workstation ${hoveredZone === slot.id ? "is-hovered" : ""} ${
                localZone === slot.id ? "is-current" : ""
              } ${occupant ? "is-occupied" : ""} ${
                occupantTone === "reconnecting" ? "is-reconnecting" : ""
              }`}
              data-seat-zone={slot.id}
              style={{
                left: `${slot.left}%`,
                top: `${slot.top}%`,
                zIndex: characterPositions[slot.id].zIndex - 3,
              }}
            >
              <div className="scene-desk-shadow" />
              <div className="scene-workstation-art-frame">
                <WorkstationArt className="scene-workstation-art" />
                <span
                  className={`scene-workstation-screen ${occupant ? "online" : ""} ${occupant?.gameName ? "gaming" : ""}`}
                >
                  {occupant?.gameName ? (
                    <>
                      <Gamepad2 aria-hidden="true" />
                      <span>{occupant.gameName}</span>
                    </>
                  ) : occupant ? (
                    <Fish className="scene-workstation-idle-fish" aria-label="摸鱼中" />
                  ) : null}
                </span>
              </div>
            </div>
          );
        })}
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
            disabled={zone.kind === "seat" && occupiedSeatIds.has(zone.id) && localZone !== zone.id}
            onPointerEnter={() => setHoveredZone(zone.id)}
            onPointerLeave={() =>
              setHoveredZone((current) => (current === zone.id ? undefined : current))
            }
            onFocus={() => setHoveredZone(zone.id)}
            onBlur={() => setHoveredZone((current) => (current === zone.id ? undefined : current))}
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
              reaction={[...reactions]
                .reverse()
                .find(
                  (reaction) =>
                    reaction.targetPeerId === member.id &&
                    Date.now() - Date.parse(reaction.createdAt) < 4_000,
                )}
              onReact={onReact}
              onVolumeChange={onVolumeChange}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
