import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Fish, Gamepad2, VolumeX } from "lucide-react";
import { AnimatePresence, motion, useAnimationControls, usePresence } from "framer-motion";
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
import {
  DeskAnimalSprite,
  type DeskAnimalIdleAction,
  WalkingAnimalSprite,
} from "./DeskAnimalSprite";
import { SceneFloorLamp, SceneWindowNook } from "./SceneAmbientDecor";
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
import type { ConnectionQualityLevel } from "../../features/network/networkDiagnostics";
import {
  planCharacterRoute,
  sceneEntryPoint,
  type CharacterMotionRoute,
} from "../../features/voice-scene/characterMotion";

const assignVisibleAvatars = (members: RoomMember[]): Map<string, BuiltInAvatarId> => {
  return new Map(
    members.map((member) => [member.id, getStableAvatarId(member.id, member.avatarId)]),
  );
};

const sceneMemberKey = (member: Pick<RoomMember, "id" | "isLocal">): string =>
  member.isLocal ? "local-member" : member.id;

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

const IDLE_ACTIONS: DeskAnimalIdleAction[] = ["look", "stretch", "sip", "type", "phone"];
type CharacterMotionPhase =
  | "entering"
  | "standing-up"
  | "walking"
  | "approaching"
  | "turning"
  | "sitting"
  | "idle"
  | "away-idle"
  | "leaving";

// Container units keep scene movement on the compositor instead of relaying out the island.
const sceneXFor = (left: number): string => `${left}cqw`;
const sceneYFor = (top: number): string => `${top}cqh`;

// Multi-segment routes keep unit velocity through obstacle corners. The first
// curve accelerates into that velocity and the last one decelerates from it,
// avoiding a visible stop/restart at every navigation waypoint.
const CHARACTER_START_EASE = [0.35, 0, 0.65, 0.65] as const;
const CHARACTER_STOP_EASE = [0.35, 0.35, 0.65, 1] as const;
const CHARACTER_SHORT_EASE = [0.45, 0, 0.55, 1] as const;

const routeEasesFor = (pointCount: number, preserveVelocity = false) => {
  const segmentCount = Math.max(1, pointCount - 1);
  if (segmentCount === 1) {
    return [preserveVelocity ? CHARACTER_STOP_EASE : CHARACTER_SHORT_EASE];
  }
  return Array.from({ length: segmentCount }, (_, index) => {
    if (index === 0) return preserveVelocity ? ("linear" as const) : CHARACTER_START_EASE;
    if (index === segmentCount - 1) return CHARACTER_STOP_EASE;
    return "linear" as const;
  });
};

const routeAnimation = (route: CharacterMotionRoute, preserveVelocity = false) => ({
  x: route.points.map((point) => sceneXFor(point.left)),
  y: route.points.map((point) => sceneYFor(point.top)),
  transition: {
    duration: route.duration,
    times: route.times,
    ease: routeEasesFor(route.points.length, preserveVelocity),
  },
});

const readSceneUnit = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const waitForMotionPhase = (durationMs: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, durationMs));

const SceneCharacter = ({
  member,
  avatarId,
  shouldReduceMotion,
  awayIndex,
  awayCount,
  zone,
  arrivalIndex,
  isWelcoming,
  isScreenSharing,
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
  arrivalIndex: number;
  isWelcoming: boolean;
  isScreenSharing: boolean;
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
  const awayZone = sceneZones.find((candidate) => candidate.id === "restroomZone");
  const awayColumnCount = Math.min(3, Math.max(1, awayCount));
  const awayColumn = awayIndex % awayColumnCount;
  const awayRow = Math.floor(awayIndex / awayColumnCount);
  const position =
    zone === "restroomZone"
      ? {
          ...basePosition,
          left:
            (awayZone?.left ?? basePosition.left) + (awayColumn - (awayColumnCount - 1) / 2) * 5,
          top: (awayZone?.top ?? 80) - 7 + awayRow * 6,
          zIndex: basePosition.zIndex + awayIndex,
        }
      : basePosition;
  const controls = useAnimationControls();
  const [isPresent, safeToRemove] = usePresence();
  const [motionPhase, setMotionPhase] = useState<CharacterMotionPhase>(
    shouldReduceMotion ? (zone === "restroomZone" ? "away-idle" : "idle") : "entering",
  );
  const [movementDirection, setMovementDirection] = useState<"left" | "right">("right");
  const [strideDurationMs, setStrideDurationMs] = useState(520);
  const [displayZone, setDisplayZone] = useState<SceneZoneId>(zone);
  const [entryRevision, setEntryRevision] = useState(shouldReduceMotion ? 1 : 0);
  const didFinishEntryRef = useRef(shouldReduceMotion);
  const operationIdRef = useRef(0);
  const motionPhaseRef = useRef<CharacterMotionPhase>(motionPhase);
  const initialZoneRef = useRef<SceneZoneId>(zone);
  const lastZoneRef = useRef<SceneZoneId>(zone);
  const activeTargetZoneRef = useRef<SceneZoneId>(zone);
  const initialDestinationRef = useRef({ left: position.left, top: position.top });
  const lastPositionRef = useRef({ left: position.left, top: position.top });
  const currentPositionRef = useRef(
    shouldReduceMotion ? { left: position.left, top: position.top } : sceneEntryPoint(),
  );
  const isWalkingVisual = ["entering", "walking", "approaching", "turning", "leaving"].includes(
    motionPhase,
  );
  const isMoving = isWalkingVisual || motionPhase === "standing-up" || motionPhase === "sitting";
  const displayPosition = displayZone === zone ? position : characterPositions[displayZone];
  const renderedCharacterScale = isWalkingVisual ? 0.86 : displayPosition.scale;
  const isZoneTransitioning = displayZone !== zone;

  const targetLeft = position.left;
  const targetTop = position.top;

  useEffect(() => {
    motionPhaseRef.current = motionPhase;
  }, [motionPhase]);

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

  useLayoutEffect(() => {
    const destination = initialDestinationRef.current;
    const initialZone = initialZoneRef.current;
    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;

    if (shouldReduceMotion) {
      controls.set({
        x: sceneXFor(destination.left),
        y: sceneYFor(destination.top),
        opacity: 1,
        scale: 1,
      });
      currentPositionRef.current = { left: destination.left, top: destination.top };
      setDisplayZone(initialZone);
      setMotionPhase(initialZone === "restroomZone" ? "away-idle" : "idle");
      didFinishEntryRef.current = true;
      setEntryRevision(1);
      return;
    }

    const enter = async () => {
      if (arrivalIndex > 0) {
        await waitForMotionPhase(Math.min(arrivalIndex, 4) * 110);
      }
      if (!isCurrentOperation()) return;
      setMotionPhase("entering");
      const route = planCharacterRoute({
        kind: "enter",
        from: sceneEntryPoint(),
        to: destination,
        toZone: initialZone,
      });
      activeTargetZoneRef.current = initialZone;
      setMovementDirection(route.direction);
      setStrideDurationMs(route.strideDurationMs);
      await controls.start({
        ...routeAnimation(route),
        opacity: 1,
        scale: 1,
        transition: {
          ...routeAnimation(route).transition,
          opacity: { duration: 0.32, ease: APPLE_MOTION_EASE },
        },
      });
      if (!isCurrentOperation()) return;
      setMotionPhase("approaching");
      await waitForMotionPhase(140);
      if (!isCurrentOperation()) return;
      setMotionPhase("turning");
      await waitForMotionPhase(150);
      if (!isCurrentOperation()) return;
      setDisplayZone(initialZone);
      setMotionPhase("sitting");
      await waitForMotionPhase(300);
      if (!isCurrentOperation()) return;
      didFinishEntryRef.current = true;
      lastZoneRef.current = initialZone;
      lastPositionRef.current = { left: destination.left, top: destination.top };
      currentPositionRef.current = { left: destination.left, top: destination.top };
      setMotionPhase(initialZone === "restroomZone" ? "away-idle" : "idle");
      setEntryRevision(1);
    };

    void enter();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      controls.stop();
    };
  }, [arrivalIndex, controls, shouldReduceMotion]);

  useEffect(() => {
    if (!isPresent || !didFinishEntryRef.current) {
      return;
    }
    const previousZone = lastZoneRef.current;
    const previousPosition = currentPositionRef.current;
    if (
      previousZone === zone &&
      previousPosition.left === targetLeft &&
      previousPosition.top === targetTop
    ) {
      return;
    }

    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const move = async () => {
      if (shouldReduceMotion) {
        controls.set({
          x: sceneXFor(targetLeft),
          y: sceneYFor(targetTop),
          opacity: 1,
          scale: 1,
        });
        currentPositionRef.current = { left: targetLeft, top: targetTop };
        lastZoneRef.current = zone;
        lastPositionRef.current = { left: targetLeft, top: targetTop };
        setDisplayZone(zone);
        setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
        return;
      }
      const wasAlreadyMoving = [
        "entering",
        "standing-up",
        "walking",
        "approaching",
        "turning",
        "leaving",
      ].includes(motionPhaseRef.current);
      if (!wasAlreadyMoving) {
        setMotionPhase("standing-up");
        await waitForMotionPhase(210);
        if (!isCurrentOperation()) return;
      }
      const routeOrigin = currentPositionRef.current;
      const route = planCharacterRoute({
        kind: "move",
        from: routeOrigin,
        to: { left: targetLeft, top: targetTop },
        fromZone: wasAlreadyMoving ? activeTargetZoneRef.current : previousZone,
        toZone: zone,
      });
      activeTargetZoneRef.current = zone;
      setMovementDirection(route.direction);
      if (!wasAlreadyMoving) setStrideDurationMs(route.strideDurationMs);
      setMotionPhase("walking");
      await controls.start({
        ...routeAnimation(route, wasAlreadyMoving),
        scale: 1,
      });
      if (!isCurrentOperation()) return;
      setMotionPhase("approaching");
      await waitForMotionPhase(140);
      if (!isCurrentOperation()) return;
      setMotionPhase("turning");
      await waitForMotionPhase(110);
      if (!isCurrentOperation()) return;
      lastZoneRef.current = zone;
      lastPositionRef.current = { left: targetLeft, top: targetTop };
      currentPositionRef.current = { left: targetLeft, top: targetTop };
      setDisplayZone(zone);
      setMotionPhase("sitting");
      await waitForMotionPhase(260);
      if (isCurrentOperation()) {
        setMotionPhase(zone === "restroomZone" ? "away-idle" : "idle");
      }
    };
    void move();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      controls.stop();
    };
  }, [controls, entryRevision, isPresent, shouldReduceMotion, targetLeft, targetTop, zone]);

  useEffect(() => {
    if (isPresent) return;
    const operationId = ++operationIdRef.current;
    const isCurrentOperation = () => operationIdRef.current === operationId;
    const leave = async () => {
      setMotionPhase("standing-up");
      if (!shouldReduceMotion) await waitForMotionPhase(220);
      if (!isCurrentOperation()) return;
      setMovementDirection("left");
      setMotionPhase("leaving");
      if (!shouldReduceMotion) {
        const route = planCharacterRoute({
          kind: "exit",
          from: currentPositionRef.current,
          to: sceneEntryPoint(),
          fromZone: activeTargetZoneRef.current,
        });
        setStrideDurationMs(route.strideDurationMs);
        await controls.start({
          ...routeAnimation(route),
          opacity: 0,
          scale: 1,
          transition: {
            ...routeAnimation(route).transition,
            opacity: { duration: 0.3, delay: Math.max(0, route.duration - 0.3) },
          },
        });
      }
      if (isCurrentOperation()) safeToRemove?.();
    };
    void leave();
    return () => {
      if (operationIdRef.current === operationId) operationIdRef.current += 1;
      controls.stop();
    };
  }, [controls, isPresent, safeToRemove, shouldReduceMotion]);

  const [idleAction, setIdleAction] = useState<DeskAnimalIdleAction>("none");

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
      initial={
        shouldReduceMotion
          ? {
              x: sceneXFor(position.left),
              y: sceneYFor(position.top),
              opacity: 1,
              scale: 1,
            }
          : {
              x: sceneXFor(sceneEntryPoint().left),
              y: sceneYFor(sceneEntryPoint().top),
              opacity: 0,
              scale: 1,
            }
      }
      animate={controls}
      className={`scene-character-motion phase-${motionPhase} pointer-events-none absolute`}
      data-scene-member-key={sceneMemberKey(member)}
      data-motion-phase={motionPhase}
      data-zone-transitioning={isZoneTransitioning ? "true" : "false"}
      onUpdate={(latest) => {
        const current = currentPositionRef.current;
        currentPositionRef.current = {
          left: readSceneUnit(latest.x, current.left),
          top: readSceneUnit(latest.y, current.top),
        };
      }}
      style={{
        opacity: isOffline ? 0.45 : undefined,
        zIndex: position.zIndex,
      }}
    >
      <div className="-translate-x-1/2" data-gsap-character>
        <div
          className="scene-character-anchor relative"
          style={
            {
              "--character-scale": renderedCharacterScale,
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
            {isWalkingVisual ? (
              <WalkingAnimalSprite
                avatarId={avatarId}
                direction={movementDirection}
                strideDurationMs={strideDurationMs}
                paused={motionPhase === "turning"}
              />
            ) : isSeatZone(displayZone) ? (
              <DeskAnimalSprite
                avatarId={avatarId}
                activity={member.activity ?? "idle"}
                isSpeaking={isSpeaking}
                isMoving={isMoving}
                isMuted={member.isMuted}
                isScreenSharing={isScreenSharing}
                isWelcoming={isWelcoming}
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

          {displayZone === "restroomZone" ? (
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
  screenSharingPeerIds = [],
  networkQuality = "pending",
  reactions = [],
  knockPulse = 0,
  reduceMotion = false,
}: {
  members: RoomMember[];
  onZoneSelect?: (zone: SceneZoneId, activity: MemberActivity) => void;
  onReact?: (targetPeerId: string, emoji: SceneReaction["emoji"]) => void;
  onVolumeChange?: (memberId: string, volume: number) => void;
  screenSharingPeerIds?: string[];
  networkQuality?: ConnectionQualityLevel;
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
  const [welcomingMemberIds, setWelcomingMemberIds] = useState<Set<string>>(new Set());
  const previousMemberIdsRef = useRef<string[]>();
  const memberSignature = visibleMembers.map(sceneMemberKey).join("|");
  const screenSharingSet = new Set(screenSharingPeerIds);
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
    const currentIds = memberSignature ? memberSignature.split("|") : [];
    const previousIds = previousMemberIdsRef.current;
    previousMemberIdsRef.current = currentIds;
    if (!previousIds?.length || !currentIds.some((id) => !previousIds.includes(id))) return;

    const stillPresent = previousIds.filter((id) => currentIds.includes(id));
    setWelcomingMemberIds(new Set(stillPresent));
    const timer = window.setTimeout(() => setWelcomingMemberIds(new Set()), 1_650);
    return () => window.clearTimeout(timer);
  }, [memberSignature]);

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
          ".scene-workstation .scene-workstation-art-frame",
          {
            keyframes: [
              { x: -6, y: -4, rotation: -1.3, duration: 0.05 },
              { x: 6, y: 2.5, rotation: 1.45, duration: 0.06 },
              { x: -4, y: -2, rotation: -0.9, duration: 0.055 },
              { x: 3, y: 1, rotation: 0.5, duration: 0.055 },
              { x: 0, y: 0, rotation: 0, duration: 0.13 },
            ],
            transformOrigin: "50% 82%",
            ease: motionEase.feedback,
            stagger: { each: 0.03, from: "center" },
          },
          0.015,
        )
        .to(
          ".scene-workstation .scene-workstation-screen",
          {
            keyframes: [
              { scale: 1.075, filter: "brightness(1.34)", duration: 0.07 },
              { scale: 0.975, filter: "brightness(1.08)", duration: 0.08 },
              { scale: 1, filter: "brightness(1)", duration: 0.12 },
            ],
            transformOrigin: "50% 60%",
            stagger: { each: 0.022, from: "center" },
          },
          0.025,
        )
        .to(
          ".scene-workstation .scene-desk-shadow",
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
        <div className="scene-window-light" />
        <div className="scene-rug" />
        <div className="scene-brand-arc" />
        <div className="scene-window-nook">
          <SceneWindowNook />
        </div>
        <div className="scene-floor-lamp">
          <SceneFloorLamp />
        </div>
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
                  className={`scene-workstation-screen ${occupant ? "online" : ""} ${
                    occupant?.gameName ? "gaming" : ""
                  } ${screenSharingSet.has(occupant?.id ?? "") ? "sharing" : ""} ${
                    networkQuality === "poor" && occupant ? "network-unstable" : ""
                  }`}
                >
                  {screenSharingSet.has(occupant?.id ?? "") ? (
                    <span className="scene-workstation-sharing-mark">共享中</span>
                  ) : occupant?.gameName ? (
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

      <AnimatePresence>
        {visibleMembers.map((member, memberIndex) => {
          const zone = resolvedMemberZones.get(member.id) ?? "gameDesk1";
          const awayIndex = awayMembers.findIndex((candidate) => candidate.id === member.id);
          return (
            <SceneCharacter
              key={sceneMemberKey(member)}
              member={member}
              avatarId={visibleAvatars.get(member.id) ?? "fox"}
              shouldReduceMotion={shouldReduceMotion}
              awayIndex={Math.max(0, awayIndex)}
              awayCount={awayMembers.length}
              zone={zone}
              arrivalIndex={memberIndex}
              isWelcoming={welcomingMemberIds.has(member.id)}
              isScreenSharing={screenSharingSet.has(member.id)}
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
